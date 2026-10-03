// 배포용 사이트를 _site/ 에 조립한다.
// - 순수 HTML 앱: 폴더를 그대로 복사
// - package.json 이 있는 앱(React 등): npm 빌드 후 dist/ 를 복사
// - _ 로 시작하는 폴더(_template 등)는 배포하지 않음
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const OUT = '_site';
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

const apps = JSON.parse(readFileSync('apps.json', 'utf8'));
if (!Array.isArray(apps)) throw new Error('apps.json 은 배열이어야 해요');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'apps'), { recursive: true });
cpSync('index.html', join(OUT, 'index.html'));
cpSync('apps.json', join(OUT, 'apps.json'));
writeFileSync(join(OUT, '.nojekyll'), '');

const folders = readdirSync('apps').filter(id => !id.startsWith('_') && !id.startsWith('.') && statSync(join('apps', id)).isDirectory());

for (const id of folders) {
  if (!ID_RE.test(id)) throw new Error(`앱 폴더 이름 '${id}' 은 영문 소문자·숫자·하이픈만 쓸 수 있어요`);
  const dir = join('apps', id);
  if (existsSync(join(dir, 'package.json'))) {
    console.log(`▶ ${id}: 빌드`);
    execSync(existsSync(join(dir, 'package-lock.json')) ? 'npm ci' : 'npm install', { cwd: dir, stdio: 'inherit' });
    execSync('npm run build', { cwd: dir, stdio: 'inherit' });
    cpSync(join(dir, 'dist'), join(OUT, 'apps', id), { recursive: true });
  } else {
    console.log(`▶ ${id}: 복사`);
    cpSync(dir, join(OUT, 'apps', id), { recursive: true });
  }
}

const listed = new Set(apps.map(a => a.id));
for (const id of folders) if (!listed.has(id)) console.warn(`⚠ '${id}' 폴더가 apps.json 에 없어서 갤러리에 안 보여요`);
for (const id of listed) if (!folders.includes(id)) console.warn(`⚠ apps.json 의 '${id}' 에 해당하는 폴더가 없어요`);

console.log(`✔ 완료: 앱 ${folders.length}개 → ${OUT}/`);
