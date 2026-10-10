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
    case 'multi_select': return (p.multi_select || []).map(o => o.name);
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

// ── 레슨 본문 분석 ──────────────────────────────────────────────
// 학습자 발화: "Learner:" / "Me:" / "나:" 로 시작하는 줄
const LEARNER = /^\s*(learner|me|나|학습자)\s*[:：]\s*/i;
const words = s => (s.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || []);

// MATTR(이동 평균 어휘 다양도): 50단어 창마다 서로 다른 단어 비율을 구해 평균. 답변 길이에 덜 흔들린다.
function mattr(tokens, win = 50) {
  if (tokens.length < 10) return null;
  if (tokens.length <= win) return new Set(tokens).size / tokens.length;
  let sum = 0, n = 0;
  for (let i = 0; i + win <= tokens.length; i++, n++) sum += new Set(tokens.slice(i, i + win)).size / win;
  return sum / n;
}

// 표현 제목에서 실제로 말할 단어만 뽑아 느슨한 정규식으로 만든다. ("end up + -ing" → end\w* … up\w*)
const FILLER = new Set(['sb', 'sth', 'someone', 'something', 'ing', 'one', 's']);
function expressionPattern(title) {
  const ws = words(String(title).replace(/\[[^\]]*\]|\\/g, ' ')).filter(w => !FILLER.has(w));
  if (!ws.length) return null;
  return new RegExp('\\b' + ws.map(w => w + '\\w*').join("(?:\\W+[\\w']+){0,2}?\\W+") + '\\b', 'i');
}

// 교정 블록: Original / Natural Version / Why 줄을 묶는다.
function corrections(body) {
  const out = [];
  let heading = '', cur = null;
  for (const b of body) {
    if (b.t === 'h') { heading = b.text; continue; }
    const m = b.text.match(/^\s*(Original|원문|Natural Version|자연스러운 표현|Why|이유)\s*[:：]\s*(.*)$/is);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === 'original' || key === '원문') { cur = { heading, original: m[2].trim() }; out.push(cur); }
    else if (cur && (key.startsWith('natural') || key === '자연스러운 표현')) cur.natural = m[2].trim();
    else if (cur) cur.why = m[2].trim();
  }
  return out.filter(c => c.original);
}

function analyze(lesson, expressionsBefore) {
  const lines = lesson.body.filter(b => LEARNER.test(b.text)).map(b => b.text.replace(LEARNER, ''));
  const tokens = lines.flatMap(words);
  const text = lines.join('\n');
  const matched = expressionsBefore.filter(e => e.pattern && e.pattern.test(text)).map(e => e.title);
  return {
    learnerTurns: lines.length,
    learnerWords: tokens.length,
    vocabDiversity: mattr(tokens),
    expansion: lines.length ? tokens.length / lines.length : null,
    reuseBase: expressionsBefore.length,
    reuseMatched: matched,
    reuseRate: expressionsBefore.length ? matched.length / expressionsBefore.length : null,
  };
}

// ── 읽기 ────────────────────────────────────────────────────────
const lessonPages = await queryAll(DS.lessons, [{ property: 'Date', direction: 'descending' }]);
const exprPages = await queryAll(DS.expressions, [{ property: 'First Learned', direction: 'descending' }]);
const reviewPages = await queryAll(DS.reviews, [{ property: 'Scheduled', direction: 'ascending' }]);

const expressions = exprPages.map(page => ({ id: page.id, url: page.url, ...props(page, [
  ['title', 'Expression'], ['status', 'Status'], ['meaning', 'Meaning'], ['example', 'Example'], ['prompt', 'Prompt'],
  ['original', 'Original'], ['register', 'Register'], ['firstLearned', 'First Learned'], ['retryDate', 'Retry Date'],
  ['passedStage', 'Passed Stage'], ['transferDates', 'Transfer Dates'], ['transferContexts', 'Transfer Contexts'],
  ['nextReview', 'Next Review'], ['mastery', 'Mastery']]) }));
const reviews = reviewPages.map(page => ({ id: page.id, url: page.url, ...props(page, [
  ['title', 'Review'], ['status', 'Status'], ['stage', 'Stage'], ['scheduled', 'Scheduled'], ['actual', 'Actual'],
  ['score', 'Score'], ['hintUsed', 'Hint Used'], ['evidence', 'Evidence'], ['expression', 'Expression']]) }));

const patterns = expressions.filter(e => e.status !== 'Template').map(e => ({ ...e, pattern: expressionPattern(e.title) }));
const lessons = [];
for (const page of lessonPages) {
  const l = { id: page.id, url: page.url, ...props(page, [
    ['title', 'Lesson'], ['status', 'Status'], ['area', 'Area'], ['mode', 'Mode'], ['date', 'Date'], ['minutes', 'Minutes'],
    ['speakingMinutes', 'Speaking Minutes'], ['sessionKey', 'Session Key'], ['accuracy', 'Accuracy'], ['fluency', 'Fluency'],
    ['coherence', 'Coherence'], ['appropriacy', 'Appropriacy'], ['errorTypes', 'Error Types']]) };
  l.body = l.status === 'Template' ? [] : await blocks(page.id);
  // 재사용률은 이 레슨 이전에 배운 표현만 기준으로 센다. 샘플 레슨은 샘플 표현끼리, 실제 레슨은 실제 표현끼리 비교한다.
  const before = patterns.filter(e => e.firstLearned && l.date && e.firstLearned.slice(0, 10) < l.date.slice(0, 10) && (e.status === 'Sample') === (l.status === 'Sample'));
  l.analysis = analyze(l, before);
  l.corrections = corrections(l.body);
  lessons.push(l);
}

await mkdir('public', { recursive: true });
await writeFile('public/data.json', JSON.stringify({ generatedAt: new Date().toISOString(), lessons, expressions, reviews }));
console.log(`완료: 레슨 ${lessons.length}, 표현 ${expressions.length}, 복습 ${reviews.length}`);
