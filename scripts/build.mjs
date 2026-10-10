// Notion 세 데이터베이스와 레슨 본문을 읽어 public/data.json을 만든다.
// 실행: NOTION_TOKEN=... node scripts/build.mjs   (Node 20 이상, 외부 패키지 없음)
import { writeFile, mkdir } from 'node:fs/promises';

const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) { console.error('NOTION_TOKEN 환경변수가 없습니다.'); process.exit(1); }

const DS = {
  lessons: process.env.LESSONS_DS || '8b9cddf1-079b-40ea-b0d3-7424364ab8a3',
  expressions: process.env.EXPRESSIONS_DS || 'b4ccc5df-4fd3-4679-b901-a1c40e636e0e',
  reviews: process.env.REVIEWS_DS || '0f124fd6-2bdd-4bcd-adb6-8c8fddb34fd7',
};
const API = 'https://api.notion.com/v1';
const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Notion은 초당 약 3회 요청을 허용한다. 요청 사이에 간격을 두고 429는 Retry-After만큼 기다린다.
async function notion(path, { method = 'GET', body } = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(350);
    const res = await fetch(API + path, { method, headers: HEADERS, body: body && JSON.stringify(body) });
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * (attempt + 1);
      console.warn(`Notion ${res.status}, ${wait}ms 후 재시도: ${path}`);
      await sleep(wait);
      continue;
    }
    const json = await res.json();
    if (!res.ok) throw new Error(`Notion ${res.status} ${json.code}: ${json.message} (${path})`);
    return json;
  }
  throw new Error(`Notion 요청이 계속 실패했습니다: ${path}`);
}

async function queryAll(dsId, sorts) {
  const out = [];
  let cursor;
  do {
    const r = await notion(`/data_sources/${dsId}/query`, { method: 'POST', body: { page_size: 100, sorts, start_cursor: cursor } });
    out.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

const plain = rt => (rt || []).map(t => t.plain_text).join('');
function value(p) {
  if (!p) return null;
  switch (p.type) {
    case 'title': return plain(p.title);
    case 'rich_text': return plain(p.rich_text);
    case 'select': return p.select?.name ?? null;
    case 'status': return p.status?.name ?? null;
    case 'number': return p.number;
    case 'checkbox': return p.checkbox;
    case 'url': return p.url;
    case 'date': return p.date?.start ?? null;
    case 'relation': return (p.relation || []).map(r => r.id);
    case 'formula': {
      const f = p.formula;
      return f.type === 'date' ? f.date?.start ?? null : f[f.type] ?? null;
    }
    default: return null;
  }
}
const props = (page, names) => Object.fromEntries(names.map(([key, name]) => [key, value(page.properties[name])]));

// 레슨 본문을 블록 단위로 읽어 {t, text} 배열로 만든다. HTML은 만들지 않는다(화면에서 안전하게 그린다).
const BLOCK_KIND = { heading_1: 'h', heading_2: 'h', heading_3: 'h', paragraph: 'p', bulleted_list_item: 'ul', numbered_list_item: 'ol', to_do: 'ul', quote: 'quote', callout: 'quote', toggle: 'p', code: 'p' };
async function blocks(id, depth = 0) {
  const out = [];
  let cursor;
  do {
    const r = await notion(`/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    for (const b of r.results) {
      const kind = BLOCK_KIND[b.type];
      const text = kind ? plain(b[b.type].rich_text) : '';
      if (kind && text.trim()) out.push({ t: kind, text, d: depth });
      if (b.has_children && depth < 2 && !['child_page', 'child_database'].includes(b.type)) out.push(...await blocks(b.id, depth + 1));
    }
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

const [lessonPages, exprPages, reviewPages] = [
  await queryAll(DS.lessons, [{ property: 'Date', direction: 'descending' }]),
  await queryAll(DS.expressions, [{ property: 'First Learned', direction: 'descending' }]),
  await queryAll(DS.reviews, [{ property: 'Scheduled', direction: 'ascending' }]),
];

const lessons = [];
for (const page of lessonPages) {
  const l = { id: page.id, url: page.url, ...props(page, [['title', 'Lesson'], ['status', 'Status'], ['area', 'Area'], ['mode', 'Mode'], ['date', 'Date'], ['minutes', 'Minutes'], ['speakingMinutes', 'Speaking Minutes'], ['sessionKey', 'Session Key']]) };
  l.body = l.status === 'Template' ? [] : await blocks(page.id);
  lessons.push(l);
}
const expressions = exprPages.map(page => ({ id: page.id, url: page.url, ...props(page, [
  ['title', 'Expression'], ['status', 'Status'], ['meaning', 'Meaning'], ['example', 'Example'], ['register', 'Register'],
  ['firstLearned', 'First Learned'], ['retryDate', 'Retry Date'], ['passedStage', 'Passed Stage'],
  ['transferDates', 'Transfer Dates'], ['transferContexts', 'Transfer Contexts'], ['nextReview', 'Next Review'], ['mastery', 'Mastery']]) }));
const reviews = reviewPages.map(page => ({ id: page.id, url: page.url, ...props(page, [
  ['title', 'Review'], ['status', 'Status'], ['stage', 'Stage'], ['scheduled', 'Scheduled'], ['actual', 'Actual'],
  ['score', 'Score'], ['hintUsed', 'Hint Used'], ['evidence', 'Evidence']]) }));

await mkdir('public', { recursive: true });
await writeFile('public/data.json', JSON.stringify({ generatedAt: new Date().toISOString(), lessons, expressions, reviews }));
console.log(`완료: 레슨 ${lessons.length}, 표현 ${expressions.length}, 복습 ${reviews.length}`);
