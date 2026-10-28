SET NAMES utf8mb4;
CREATE DATABASE IF NOT EXISTS newsdb CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE newsdb;

CREATE TABLE outlets (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  outlet_key       VARCHAR(64)  NOT NULL,
  name             VARCHAR(255) NOT NULL,
  primary_domain   VARCHAR(255) NOT NULL,
  country          CHAR(2) NULL,
  ownership_group  VARCHAR(128) NULL,
  reliability_tier ENUM('high','medium','low') NOT NULL DEFAULT 'medium',
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_outlet_key (outlet_key),
  UNIQUE KEY uq_primary_domain (primary_domain)
) ENGINE=InnoDB;

CREATE TABLE outlet_domains (
  domain    VARCHAR(255) NOT NULL PRIMARY KEY,
  outlet_id INT UNSIGNED NOT NULL,
  CONSTRAINT fk_od_outlet FOREIGN KEY (outlet_id) REFERENCES outlets(id)
) ENGINE=InnoDB;

CREATE TABLE feeds (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  outlet_id       INT UNSIGNED NOT NULL,
  url             VARCHAR(1024) NOT NULL,
  url_hash        CHAR(64) NOT NULL,
  topic           VARCHAR(64) NULL,
  enabled         TINYINT(1) NOT NULL DEFAULT 1,
  last_fetched_at DATETIME NULL,
  last_status     VARCHAR(255) NULL,
  UNIQUE KEY uq_feed_url (url_hash),
  CONSTRAINT fk_feed_outlet FOREIGN KEY (outlet_id) REFERENCES outlets(id)
) ENGINE=InnoDB;

CREATE TABLE articles (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  outlet_id           INT UNSIGNED NOT NULL,
  feed_id             INT UNSIGNED NULL,
  title               VARCHAR(1024) NOT NULL,
  url                 TEXT NOT NULL,
  canonical_url       TEXT NOT NULL,
  canonical_url_hash  CHAR(64) NOT NULL,
  summary             TEXT NULL,
  author              VARCHAR(255) NULL,
  published_at        DATETIME NOT NULL,
  fetched_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  content_hash        CHAR(64) NOT NULL,
  topic               VARCHAR(128) NULL,
  is_wire_copy        TINYINT(1) NOT NULL DEFAULT 0,
  verification_status ENUM('unverified','corroborated','rejected') NOT NULL DEFAULT 'unverified',
  verification_reason TEXT NULL,
  verified_at         DATETIME NULL,
  verified_by         VARCHAR(64) NULL,
  UNIQUE KEY uq_canonical (canonical_url_hash),
  KEY idx_status_pub (verification_status, published_at),
  KEY idx_outlet_pub (outlet_id, published_at),
  KEY idx_content_hash (content_hash),
  KEY idx_topic (topic),
  FULLTEXT KEY ft_title_summary (title, summary),
  CONSTRAINT fk_article_outlet FOREIGN KEY (outlet_id) REFERENCES outlets(id),
  CONSTRAINT fk_article_feed   FOREIGN KEY (feed_id)   REFERENCES feeds(id)
) ENGINE=InnoDB;

-- No ON DELETE CASCADE: MySQL forbids FK referential actions on columns used in CHECK constraints.
CREATE TABLE corroborations (
  id                       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  article_id               BIGINT UNSIGNED NOT NULL,
  corroborating_article_id BIGINT UNSIGNED NOT NULL,
  score                    DECIMAL(5,4) NOT NULL,
  title_overlap            DECIMAL(5,4) NOT NULL,
  keyword_jaccard          DECIMAL(5,4) NOT NULL,
  method                   ENUM('similarity','syndicated') NOT NULL,
  confirmed_by             VARCHAR(64) NOT NULL,
  created_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pair (article_id, corroborating_article_id),
  CONSTRAINT chk_not_self CHECK (article_id <> corroborating_article_id),
  CONSTRAINT fk_c_article FOREIGN KEY (article_id) REFERENCES articles(id),
  CONSTRAINT fk_c_corr    FOREIGN KEY (corroborating_article_id) REFERENCES articles(id)
) ENGINE=InnoDB;

CREATE TABLE verification_events (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  article_id  BIGINT UNSIGNED NOT NULL,
  from_status ENUM('unverified','corroborated','rejected') NOT NULL,
  to_status   ENUM('unverified','corroborated','rejected') NOT NULL,
  reason      TEXT NOT NULL,
  actor       VARCHAR(64) NOT NULL,           -- 'claude' | 'auto' | 'cascade'
  details     JSON NULL,                      -- corroborator ids, scores, independent groups
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ve_article (article_id),
  CONSTRAINT fk_ve_article FOREIGN KEY (article_id) REFERENCES articles(id)
) ENGINE=InnoDB;

CREATE TABLE reports (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug       VARCHAR(128) NOT NULL,
  title      VARCHAR(512) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_slug (slug)
) ENGINE=InnoDB;

CREATE TABLE report_citations (
  report_id      INT UNSIGNED NOT NULL,
  article_id     BIGINT UNSIGNED NOT NULL,
  citation_style VARCHAR(16) NOT NULL,
  cited_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (report_id, article_id),
  CONSTRAINT fk_rc_report  FOREIGN KEY (report_id)  REFERENCES reports(id),
  CONSTRAINT fk_rc_article FOREIGN KEY (article_id) REFERENCES articles(id)
) ENGINE=InnoDB;

DELIMITER $$
CREATE TRIGGER trg_corroborations_bi BEFORE INSERT ON corroborations FOR EACH ROW
BEGIN
  DECLARE g1 VARCHAR(128); DECLARE g2 VARCHAR(128);
  SELECT COALESCE(o.ownership_group, o.outlet_key) INTO g1
    FROM articles a JOIN outlets o ON o.id = a.outlet_id WHERE a.id = NEW.article_id;
  SELECT COALESCE(o.ownership_group, o.outlet_key) INTO g2
    FROM articles a JOIN outlets o ON o.id = a.outlet_id WHERE a.id = NEW.corroborating_article_id;
  IF g1 = g2 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'corroboration must come from an independent outlet';
  END IF;
END$$

CREATE TRIGGER trg_report_citations_bi BEFORE INSERT ON report_citations FOR EACH ROW
BEGIN
  IF COALESCE((SELECT verification_status FROM articles WHERE id = NEW.article_id), 'missing') <> 'corroborated' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'only corroborated articles may be cited';
  END IF;
END$$
DELIMITER ;

CREATE OR REPLACE VIEW v_reference_ready AS
SELECT a.id, a.title, a.canonical_url, a.published_at, a.topic, o.name AS outlet, o.outlet_key,
       COUNT(DISTINCT COALESCE(o2.ownership_group, o2.outlet_key)) AS independent_corroborators,
       GROUP_CONCAT(DISTINCT o2.name ORDER BY o2.name SEPARATOR '; ') AS corroborating_outlets
FROM articles a
JOIN outlets o ON o.id = a.outlet_id
JOIN corroborations c ON c.article_id = a.id AND c.method = 'similarity'
JOIN articles a2 ON a2.id = c.corroborating_article_id AND a2.verification_status <> 'rejected'
JOIN outlets o2 ON o2.id = a2.outlet_id
WHERE a.verification_status = 'corroborated'
GROUP BY a.id, a.title, a.canonical_url, a.published_at, a.topic, o.name, o.outlet_key;
