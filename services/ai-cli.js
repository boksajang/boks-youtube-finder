// ==========================================================================
// BOKS YOUTUBE FINDER - AI CLI Service (Claude Code CLI / Codex CLI)
//  - 프롬프트는 셸 인자가 아니라 stdin 으로 전달한다(줄바꿈 손실·명령 주입 방지).
//  - CLI 는 비어 있는 전용 작업 폴더(app-data/ai-workspace)에서 도구 없이 실행한다.
// ==========================================================================

const { spawn, execFile } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const isWin = process.platform === 'win32';
const TIMEOUT_MS = 180000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

class AiCliError extends Error {
  constructor(message, code, detail = '') {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

// --- CLI 경로 탐색 ---

function execFileText(file, args, timeout = 5000) {
  return new Promise(resolve => {
    execFile(file, args, { timeout, windowsHide: true, encoding: 'utf8' }, (err, stdout) => resolve(err ? '' : String(stdout || '')));
  });
}

function candidatePaths(engine) {
  const home = os.homedir();
  if (isWin) {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return engine === 'codex'
      ? [path.join(appData, 'npm', 'codex.cmd'), path.join(localAppData, 'Programs', 'codex', 'codex.exe')]
      : [path.join(home, '.local', 'bin', 'claude.exe'), path.join(appData, 'npm', 'claude.cmd'), path.join(home, '.claude', 'local', 'claude.exe')];
  }
  const bin = engine;
  return [
    path.join(home, '.local', 'bin', bin),
    path.join(home, '.claude', 'local', bin),
    `/opt/homebrew/bin/${bin}`,
    `/usr/local/bin/${bin}`,
    path.join(home, '.npm-global', 'bin', bin)
  ];
}

/** @returns {Promise<{found:boolean, path:string}>} */
async function detectCliPath(engine) {
  const name = engine === 'codex' ? 'codex' : 'claude';
  let found = [];

  if (isWin) {
    // where 는 PATHEXT 순서대로 .exe/.cmd 를 모두 찾는다
    found = (await execFileText('where.exe', [name])).split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      .filter(p => /\.(exe|cmd|bat)$/i.test(p));
    found.sort((a, b) => (/\.exe$/i.test(b) ? 1 : 0) - (/\.exe$/i.test(a) ? 1 : 0));
  } else {
    // GUI 로 실행된 앱은 PATH 가 짧으므로 로그인 셸에서 확인
    const shell = process.env.SHELL || '/bin/sh';
    const out = (await execFileText(shell, ['-lc', `command -v ${name}`])).trim();
    if (out.startsWith('/')) found = [out.split('\n')[0]];
  }

  for (const p of [...found, ...candidatePaths(name)]) {
    if (p && fs.existsSync(p)) return { found: true, path: p };
  }
  return { found: false, path: '' };
}

// --- 프롬프트 ---

/**
 * AI 에 넘길 영상: 떡상 판정(조회수 하한선 통과 & 메인 점수 3배 이상) 영상을 점수순으로 최대 10개.
 * 5개 미만이면 나머지를 조회수 상위 영상으로 채운다.
 */
const isOutlier = v => v.qualifies && v.score >= 3;

function pickPromptVideos(videos) {
  const list = (videos || []).filter(v => v.viewCount > 0);
  const outliers = list.filter(isOutlier)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  if (outliers.length >= 5) return { picked: outliers, supplemented: false };
  const rest = list.filter(v => !outliers.includes(v)).sort((a, b) => b.viewCount - a.viewCount);
  return { picked: [...outliers, ...rest].slice(0, 10), supplemented: true };
}

function buildPrompt(keyword, videos) {
  const { picked: ranked, supplemented } = pickPromptVideos(videos);

  const lines = ranked.map((v, i) => {
    const main = v.scoreBasis === 'baseline'
      ? `채널 평소(최근 같은 형식 영상 중앙값 ${v.channelBaselineFormatted}회) 대비 ${v.scoreFormatted}`
      : v.scoreBasis === 'subs'
        ? `채널 평소 조회수 확인 불가 → 구독자 대비 ${v.scoreFormatted}(추정)`
        : '배수 계산 불가';
    return [
      `${i + 1}. [${v.isShorts ? '쇼츠' : '롱폼'}] ${sanitize(v.title)}`,
      `   채널: ${sanitize(v.channelTitle)} (구독자 ${v.subscriberCountFormatted}) · 조회수 ${v.viewCountFormatted}`,
      `   ${main} · 구독자 대비 ${v.subsRatioFormatted} · 하루 평균 ${v.viewsPerDayFormatted}회 · ${v.publishedAtRelative} 업로드${isOutlier(v) ? ' · 떡상' : ''}`
    ].join('\n');
  }).join('\n');

  const rule = '떡상 영상 = 조회수 1만 회 이상이면서 그 채널 평소 조회수의 3배 이상';
  const intro = supplemented
    ? `아래는 이 키워드로 검색한 실제 영상입니다. 떡상 영상(${rule})이 적어 조회수 상위 영상을 함께 넣었습니다. "떡상" 표시가 있는 영상에 더 무게를 두세요.`
    : `아래는 이 키워드로 검색한 실제 영상 중 떡상 영상(${rule})을 배수 순으로 고른 것입니다.`;

  return `당신은 한국 유튜브 시장을 분석하는 콘텐츠 전략가입니다.
검색 키워드: "${sanitize(keyword)}"

${intro}
<videos>
${lines}
</videos>

이 데이터를 근거로, 이제 막 시작하는 크리에이터가 바로 제작할 수 있는 기획안을 작성하세요.
- 데이터에 없는 수치를 지어내지 마세요.
- 모든 문장은 자연스러운 한국어로 쓰세요.
- 출력은 아래 스키마의 JSON 객체 하나만 쓰세요. 코드블록·설명·인사말을 붙이지 마세요.

{
  "summary": "이 키워드에서 조회수가 터지는 핵심 패턴 한 문장",
  "hookingAngles": ["시청자를 끈 패턴과 이유 1", "패턴과 이유 2", "패턴과 이유 3"],
  "recommendations": [
    {
      "format": "롱폼 또는 쇼츠",
      "title": "클릭률을 높일 영상 제목 후보",
      "thumbnailConcept": "썸네일 시각 요소와 문구",
      "hookIntro": "시작 10초 오프닝 대본 뼈대"
    }
  ],
  "blueOceanInsight": "대형 채널과 겹치지 않는 틈새 공략 각도"
}
recommendations 는 정확히 3개를 작성하세요.`;
}

// 프롬프트 구조를 깨는 제어문자 제거
function sanitize(s) {
  return String(s || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/<\/?videos>/gi, '').slice(0, 300);
}

// --- 출력 파싱 ---

function decodeConsole(buf) {
  if (!buf || buf.length === 0) return '';
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // 한국어 Windows 의 cmd.exe/콘솔 메시지(CP949)
    try { return new TextDecoder('euc-kr').decode(buf); } catch { return buf.toString('latin1'); }
  }
}

function extractJsonObject(text) {
  const src = String(text || '').trim();
  try {
    const whole = JSON.parse(src);
    if (whole && typeof whole === 'object') return whole;
  } catch { /* 앞뒤에 설명·코드펜스가 붙은 경우 아래에서 추출 */ }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(src);
  const body = fenced ? fenced[1] : src;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function normalizeReport(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const recommendations = (Array.isArray(obj.recommendations) ? obj.recommendations : [])
    .filter(r => r && typeof r === 'object')
    .map(r => ({
      format: str(r.format) || '기획안',
      title: str(r.title),
      thumbnailConcept: str(r.thumbnailConcept),
      hookIntro: str(r.hookIntro)
    }))
    .filter(r => r.title);
  const report = {
    summary: str(obj.summary),
    hookingAngles: (Array.isArray(obj.hookingAngles) ? obj.hookingAngles : []).map(str).filter(Boolean),
    recommendations,
    blueOceanInsight: str(obj.blueOceanInsight)
  };
  return report.summary && report.recommendations.length > 0 ? report : null;
}

// --- 실행 ---

let currentJob = null;
let jobToken = 0;
const detectCache = {};

// 자동 탐색 결과는 파일이 남아 있는 동안 재사용한다(매 요청마다 where.exe 실행 방지)
async function detectCachedCliPath(engine) {
  const hit = detectCache[engine];
  if (hit && hit.found && fs.existsSync(hit.path)) return hit;
  const det = await detectCliPath(engine);
  if (det.found) detectCache[engine] = det;
  return det;
}

function killTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (isWin) {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
    }
  }
}

function cancel() {
  jobToken++;
  if (!currentJob) return false;
  currentJob.cancelled = true;
  killTree(currentJob.child);
  return true;
}

function buildInvocation(engine, exe) {
  const args = engine === 'codex'
    ? ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', '-']
    : ['-p', '--output-format', 'json', '--tools', '', '--no-session-persistence', '--strict-mcp-config'];

  // .cmd/.bat 는 셸이 필요하다. 인자는 모두 고정 상수이고 사용자 데이터는 stdin 으로만 전달한다.
  if (isWin && /\.(cmd|bat)$/i.test(exe)) {
    const quoted = [exe, ...args].map(a => `"${a}"`).join(' ');
    return { command: quoted, args: [], shell: true };
  }
  return { command: exe, args, shell: false };
}

function childEnv() {
  const env = { ...process.env };
  // 상위 Claude Code 세션 안에서 앱을 띄운 경우의 중첩 실행 표식 제거
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

async function generateStrategy({ engine = 'claude', customPath = '', keyword, videos, workDir }) {
  if (!videos || videos.length === 0) {
    throw new AiCliError('분석할 영상 데이터가 없습니다.', 'NO_DATA');
  }
  if (pickPromptVideos(videos).picked.length === 0) {
    throw new AiCliError('조회수가 있는 영상이 없어 기획안을 만들 수 없습니다.', 'NO_DATA');
  }
  const engineName = engine === 'codex' ? 'Codex' : 'Claude';

  // 이전 요청을 먼저 중단하고 토큰을 받는다. 경로 탐색(await) 중에 cancel()·새 요청이 오면 토큰이 바뀐다.
  cancel();
  const token = jobToken;
  const assertActive = () => {
    if (token !== jobToken) throw new AiCliError('AI 분석을 중단했습니다.', 'CANCELLED');
  };

  let exe = (customPath || '').trim().replace(/^"(.*)"$/, '$1');
  if (exe) {
    if (path.isAbsolute(exe) && !fs.existsSync(exe)) {
      throw new AiCliError(`설정된 ${engineName} CLI 경로에 파일이 없습니다: ${exe}`, 'CLI_NOT_FOUND');
    }
  } else {
    const det = await detectCachedCliPath(engine);
    assertActive();
    if (!det.found) {
      throw new AiCliError(`${engineName} CLI를 찾지 못했습니다. 설치 후 [설정]에서 [자동 찾기]를 눌러 주세요.`, 'CLI_NOT_FOUND');
    }
    exe = det.path;
  }

  assertActive();
  fs.mkdirSync(workDir, { recursive: true });
  const prompt = buildPrompt(keyword, videos);
  const inv = buildInvocation(engine, exe);

  return new Promise((resolve, reject) => {
    // POSIX 에서는 프로세스 그룹을 만들어 트리 전체를 종료할 수 있게 한다
    const child = spawn(inv.command, inv.args, { cwd: workDir, env: childEnv(), shell: inv.shell, windowsHide: true, detached: !isWin });
    const job = { child, cancelled: false };
    currentJob = job;

    const out = [];
    const err = [];
    let outBytes = 0;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, TIMEOUT_MS);

    child.stdout.on('data', d => { outBytes += d.length; if (outBytes <= MAX_OUTPUT_BYTES) out.push(d); });
    child.stderr.on('data', d => { if (err.length < 200) err.push(d); });
    child.stdin.on('error', () => { /* 프로세스가 먼저 종료된 경우 */ });
    child.stdin.end(prompt, 'utf8');

    const finish = (fn) => {
      clearTimeout(timer);
      if (currentJob === job) currentJob = null;
      fn();
    };

    child.on('error', e => finish(() => reject(new AiCliError(`${engineName} CLI를 실행하지 못했습니다. [설정]에서 경로를 확인해 주세요.`, 'CLI_SPAWN', `${exe}\n${e.message}`))));

    child.on('close', code => finish(() => {
      const stdout = Buffer.concat(out).toString('utf8').trim();
      const stderr = decodeConsole(Buffer.concat(err)).trim();

      if (job.cancelled) return reject(new AiCliError('AI 분석을 중단했습니다.', 'CANCELLED'));
      if (timedOut) return reject(new AiCliError(`${engineName} CLI가 ${TIMEOUT_MS / 1000}초 안에 응답하지 않아 중단했습니다.`, 'TIMEOUT'));

      let text = stdout;
      if (engine !== 'codex') {
        // claude -p --output-format json → { type:'result', is_error, result }
        const wrapper = extractJsonObject(stdout);
        if (wrapper && typeof wrapper.result === 'string') {
          if (wrapper.is_error) {
            const loginNeeded = /\/login|log in|not logged|authenticat|로그인/i.test(wrapper.result);
            return reject(new AiCliError(
              loginNeeded ? `${engineName} CLI 로그인이 필요합니다. 터미널에서 claude 를 실행해 로그인해 주세요.` : `${engineName} CLI가 오류를 반환했습니다.`,
              loginNeeded ? 'CLI_LOGIN' : 'CLI_ERROR', wrapper.result.slice(0, 2000)));
          }
          text = wrapper.result;
        }
      }

      if (code !== 0 && !text) {
        const notFound = /not recognized|인식되지 않|No such file|not found/i.test(stderr);
        const loginNeeded = /login|log in|authenticat|로그인/i.test(stderr + stdout);
        const message = notFound ? `${engineName} CLI를 찾지 못했습니다. [설정]에서 경로를 확인해 주세요.`
          : loginNeeded ? `${engineName} CLI 로그인이 필요합니다. 터미널에서 ${engine === 'codex' ? 'codex login' : 'claude'} 을 실행해 로그인해 주세요.`
          : `${engineName} CLI가 비정상 종료되었습니다 (코드 ${code}).`;
        return reject(new AiCliError(message, notFound ? 'CLI_NOT_FOUND' : 'CLI_EXIT', stderr.slice(0, 2000)));
      }

      const report = normalizeReport(extractJsonObject(text));
      if (!report) {
        return reject(new AiCliError('AI 응답을 기획안 형식으로 해석하지 못했습니다. [다시 생성]을 눌러 주세요.', 'BAD_FORMAT', text.slice(0, 3000)));
      }
      const basis = pickPromptVideos(videos);
      resolve({ ...report, engine: engineName, basisCount: basis.picked.length, basisSupplemented: basis.supplemented });
    }));
  });
}

module.exports = {
  detectCliPath,
  generateStrategy,
  cancel,
  // 테스트용
  _internal: { buildPrompt, pickPromptVideos, buildInvocation, extractJsonObject, normalizeReport, decodeConsole }
};
