// Citation formatting. Only corroborated articles can be formatted.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON_MLA = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];

export class ReferenceError_ extends Error {}

function asDate(d) {
  const x = d instanceof Date ? d : new Date(typeof d === 'string' && !/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? d.replace(' ', 'T') + 'Z' : d);
  if (Number.isNaN(x.getTime())) throw new ReferenceError_(`invalid date: ${d}`);
  return x;
}
const ymd = (d) => d.toISOString().slice(0, 10);
const longDate = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
const mlaDate = (d) => `${d.getUTCDate()} ${MON_MLA[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

export function assertCorroborated(article) {
  if (!article || article.verification_status !== 'corroborated') {
    throw new ReferenceError_(`article ${article?.id ?? '?'} is not corroborated (status: ${article?.verification_status ?? 'missing'})`);
  }
}

export function assertAllCorroborated(articles) {
  const bad = articles.filter((a) => a?.verification_status !== 'corroborated');
  if (bad.length) throw new ReferenceError_(`not corroborated: ${bad.map((a) => `${a?.id}:${a?.verification_status ?? 'missing'}`).join(', ')}`);
}

const outletName = (a) => a.outlet ?? a.outlet_name ?? a.outlet_key ?? 'Unknown outlet';
const urlOf = (a) => a.canonical_url ?? a.url;
const stripDot = (s) => String(s).trim().replace(/[.]+$/, '');

/**
 * @param article       {id,title,outlet,canonical_url,published_at,author?,verification_status}
 * @param corroborators array of outlet names (strings) or objects with outlet/name
 * @param style         apa|mla|chicago|markdown
 * @param accessedDate  Date (MLA)
 * @param n             number for markdown style
 */
export function formatReference(article, corroborators, style = 'apa', accessedDate = new Date(), n = 1) {
  assertCorroborated(article);
  const pub = asDate(article.published_at);
  const acc = asDate(accessedDate);
  const title = stripDot(article.title);
  const outlet = outletName(article);
  const url = urlOf(article);
  const names = [...new Set((corroborators || []).map((c) => (typeof c === 'string' ? c : c.outlet ?? c.name ?? c.outlet_key)).filter(Boolean))].sort();
  const corr = ` Corroborated by: ${names.length ? names.join(', ') : 'none listed'}.`;
  let text;
  switch (style) {
    case 'apa':
      text = article.author
        ? `${stripDot(article.author)}. (${pub.getUTCFullYear()}, ${MONTHS[pub.getUTCMonth()]} ${pub.getUTCDate()}). ${title}. *${outlet}*. ${url}`
        : `${title}. (${pub.getUTCFullYear()}, ${MONTHS[pub.getUTCMonth()]} ${pub.getUTCDate()}). *${outlet}*. ${url}`;
      break;
    case 'mla':
      text = `"${title}." *${outlet}*, ${mlaDate(pub)}, ${url}. Accessed ${mlaDate(acc)}.`;
      break;
    case 'chicago':
      text = `${outlet}. "${title}." ${longDate(pub)}. ${url}.`;
      break;
    case 'markdown':
      text = `[${n}] ${outlet} — "${title}" (${ymd(pub)}). <${url}>`;
      break;
    default:
      throw new ReferenceError_(`unknown style ${style}`);
  }
  return text + corr;
}

/** items: [{article, corroborators}] -> {references:[{article_id,text}], formatted} */
export function formatList(items, style = 'apa', accessedDate = new Date()) {
  const sorted = [...items].sort((x, y) => asDate(x.article.published_at) - asDate(y.article.published_at) || Number(x.article.id) - Number(y.article.id));
  const references = sorted.map((it, i) => ({ article_id: Number(it.article.id), text: formatReference(it.article, it.corroborators, style, accessedDate, i + 1) }));
  const formatted = references.map((r, i) => (style === 'markdown' ? r.text : `${i + 1}. ${r.text}`)).join('\n');
  return { references, formatted };
}
