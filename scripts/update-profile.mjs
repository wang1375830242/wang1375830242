// 重新生成 assets/hero.svg：把季节、卷目星数、仓库总数、总星数、落笔数写进整页图。
// 只有内容真的变了才写文件，避免每天制造空提交。
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

const USER = 'wang1375830242';
const TEMPLATE = new URL('../design/hero.template.svg', import.meta.url);
const OUTPUT = new URL('../assets/hero.svg', import.meta.url);
const AVATAR = new URL('../assets/avatar.png', import.meta.url);

// 主页文案（三行：前两行正文，第三行朱笔）
const COPY = {
  line1: '一介凡人，误入此间。晨钟暮鼓，各自修行。',
  line2: '不求飞升，只愿每一世都算数。',
  line3: '落笔即修行。',
};

// 卷目里展示的三个仓库（顺序即展示顺序），星数自动抓
const FEATURED = [
  { repo: 'TraeGuard', key: 'STAR_1' },
  { repo: 'yijie-fanren', key: 'STAR_2' },
  { repo: 'wang1375830242.github.io', key: 'STAR_3' },
];

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const headers = {
  'User-Agent': 'sakura-profile-updater',
  Accept: 'application/vnd.github+json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

function shanghai(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}

// 以节气为界：立春 2/4、立夏 5/5、立秋 8/7、立冬 11/7（常用近似日）
function seasonOf(m, d) {
  const md = m * 100 + d;
  if (md >= 204 && md < 505) return '春';
  if (md >= 505 && md < 807) return '夏';
  if (md >= 807 && md < 1107) return '秋';
  return '冬';
}

function cnYear(y) {
  const map = '〇一二三四五六七八九';
  return String(y).split('').map((c) => map[Number(c)]).join('');
}

async function getJson(url, options = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
      if (res.ok) return await res.json();
      last = new Error(`HTTP ${res.status}`);
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
  }
  throw last;
}

async function listRepos() {
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const chunk = await getJson(`https://api.github.com/users/${USER}/repos?per_page=100&page=${page}&sort=pushed`);
    all.push(...chunk);
    if (chunk.length < 100) break;
  }
  return all;
}

async function totalContributions() {
  if (!TOKEN) return null;
  const query = `query { user(login: "${USER}") { contributionsCollection { contributionCalendar { totalContributions } } } }`;
  try {
    const json = await getJson('https://api.github.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    return json?.data?.user?.contributionsCollection?.contributionCalendar?.totalContributions ?? null;
  } catch {
    return null;
  }
}

const { y, m, d } = shanghai();
const season = seasonOf(m, d);

const repos = await listRepos();
const byName = new Map(repos.map((r) => [r.name, r]));

for (const item of FEATURED) {
  if (!byName.has(item.repo)) throw new Error(`找不到仓库 ${item.repo}`);
}

const starTotal = repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
const latest = FEATURED
  .map((x) => byName.get(x.repo).pushed_at)
  .sort()
  .at(-1)
  .slice(0, 10);

// 落笔数取不到时，沿用上一版 SVG 里的值，再不行用 148 兜底
let commits = await totalContributions();
if (commits == null) {
  try {
    const old = await readFile(OUTPUT, 'utf8');
    commits = old.match(/(\d+) 次落笔/)?.[1] ?? 148;
  } catch {
    commits = 148;
  }
}

const avatarB64 = (await readFile(AVATAR)).toString('base64');
let svg = await readFile(TEMPLATE, 'utf8');

// 竖排落款：一个字一行，避免 writing-mode 在某些渲染器里把字横过来
const dateline = [...`${cnYear(y)}·${season}`]
  .map((ch, i) => `<text x="92" y="${408 + i * 13}" font-size="11" fill="#6E6252" text-anchor="middle">${ch}</text>`)
  .join('\n  ');
svg = svg.replace('<!--DATELINE-->', dateline);

const vars = {
  AVATAR_B64: avatarB64,
  BIO_1: COPY.line1,
  BIO_2: COPY.line2,
  BIO_3: COPY.line3,
  YEAR_CN: cnYear(y),
  SEASON: season,
  STAR_1: byName.get('TraeGuard').stargazers_count,
  STAR_2: byName.get('yijie-fanren').stargazers_count,
  STAR_3: byName.get('wang1375830242.github.io').stargazers_count,
  REPO_TOTAL: repos.length,
  STAR_TOTAL: starTotal,
  COMMIT_TOTAL: commits,
  LATEST: latest,
};

for (const [key, value] of Object.entries(vars)) {
  svg = svg.split(`{{${key}}}`).join(String(value));
}

const left = svg.match(/\{\{[A-Z0-9_]+\}\}/g);
if (left) throw new Error(`模板里还有没替换的占位符：${left.join(', ')}`);

let previous = '';
try {
  previous = await readFile(OUTPUT, 'utf8');
} catch {}

if (previous === svg) {
  console.log('内容没有变化，不写文件。');
  process.exit(0);
}

if (process.argv.includes('--dry')) {
  console.log(`预览：${cnYear(y)}·${season}，${repos.length} 仓库 / ${starTotal} 星 / ${commits} 落笔，最新 ${latest}`);
  process.exit(0);
}

await writeFile(OUTPUT, svg, 'utf8');
console.log(`已生成 hero.svg：${cnYear(y)}·${season}，${repos.length} 仓库 / ${starTotal} 星 / ${commits} 落笔。`);
