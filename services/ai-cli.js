// ==========================================================================
// BOKS YOUTUBE FINDER - AI CLI Service (Claude Code CLI / Codex CLI)
//  - 프롬프트는 셸 인자가 아니라 stdin 으로 전달한다(줄바꿈 손실·명령 주입 방지).
//  - CLI 는 비어 있는 전용 작업 폴더(app-data/ai-workspace)에서 도구 없이 실행한다.
// ==========================================================================

const { spawn, execFile } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { computeTrends } = require('./trends');

const isWin = process.platform === 'win32';
const TIMEOUT_MS = 240000; // 형식별 상세 기획안은 응답이 길다
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

const isOutlier = v => v.qualifies && v.score >= 3;
const FORMAT_LABEL = { all: '쇼츠·롱폼 전체', long: '롱폼', shorts: '쇼츠' };

/**
 * AI 에 넘길 영상: 떡상 판정 영상을 점수순으로, 부족하면 조회수 상위 영상으로 채운다.
 *   전체: 쇼츠·롱폼 각각 최대 8개 / 한 형식: 최대 12개
 */
function pickFrom(list, limit) {
  list = list.filter(v => v.viewCount > 0);
  const outliers = list.filter(isOutlier).sort((a, b) => b.score - a.score).slice(0, limit);
  if (outliers.length >= Math.min(5, limit)) return { picked: outliers, supplemented: false };
  const rest = list.filter(v => !outliers.includes(v)).sort((a, b) => b.viewCount - a.viewCount);
  return { picked: [...outliers, ...rest].slice(0, limit), supplemented: true };
}

function pickPromptVideos(videos, format = 'all') {
  const list = videos || [];
  if (format === 'all') {
    const s = pickFrom(list.filter(v => v.isShorts), 8);
    const l = pickFrom(list.filter(v => !v.isShorts), 8);
    return { picked: [...s.picked, ...l.picked], supplemented: s.supplemented || l.supplemented, shortsCount: s.picked.length, longCount: l.picked.length };
  }
  const only = list.filter(v => (format === 'shorts' ? v.isShorts : !v.isShorts));
  const r = pickFrom(only, 12);
  return { ...r, shortsCount: format === 'shorts' ? r.picked.length : 0, longCount: format === 'long' ? r.picked.length : 0 };
}

function videoLine(v, i) {
  const main = v.scoreBasis === 'baseline'
    ? `채널 평소(최근 같은 형식 영상 중앙값 ${v.channelBaselineFormatted}회) 대비 ${v.scoreFormatted}`
    : v.scoreBasis === 'subs'
      ? `채널 평소 조회수 확인 불가 → 구독자 대비 ${v.scoreFormatted}(추정)`
      : '배수 계산 불가';
  const tags = (v.tags || []).slice(0, 6).map(sanitize).join(', ');
  return [
    `${i + 1}. [${v.isShorts ? '쇼츠' : '롱폼'} ${v.durationFormatted || '?'}] ${sanitize(v.title)}`,
    `   채널: ${sanitize(v.channelTitle)} (구독자 ${v.subscriberCountFormatted}) · 조회수 ${v.viewCountFormatted} · ${v.publishedAtRelative} 업로드${isOutlier(v) ? ' · 떡상' : ''}`,
    `   ${main} · 구독자 대비 ${v.subsRatioFormatted} · 하루 평균 ${v.viewsPerDayFormatted}회${v.likeRate !== null && v.likeRate !== undefined ? ` · 좋아요율 ${v.likeRate}%` : ''}`,
    tags ? `   태그: ${tags}` : ''
  ].filter(Boolean).join('\n');
}

function trendSummary(t, format) {
  if (!t || !t.totals || t.totals.count === 0) return '';
  const lines = [];
  const tt = t.totals;
  lines.push(`- 분석 영상 ${tt.count}개 · 떡상 ${tt.outlierCount}개(${tt.outlierRate}%) · 조회수 중앙값 ${tt.medianViews.toLocaleString('ko-KR')}회 · 최근 30일 영상 ${tt.recent30Share}%`);
  if (format === 'all') {
    const s = t.formatSplit.shorts;
    const l = t.formatSplit.long;
    lines.push(`- 쇼츠 ${s.count}개(떡상 ${s.outlierRate}%, 평소 대비 중앙값 ${s.medianScore ?? '-'}배) · 롱폼 ${l.count}개(떡상 ${l.outlierRate}%, 평소 대비 중앙값 ${l.medianScore ?? '-'}배)`);
  }
  (t.findings || []).forEach(f => lines.push(`- ${f.text}`));
  if (t.topTags && t.topTags.length) lines.push(`- 자주 쓰인 태그: ${t.topTags.slice(0, 10).map(x => sanitize(x.tag)).join(', ')}`);
  return lines.join('\n');
}

const PLAN_SCHEMA = {
  shorts: `    {
      "format": "쇼츠",
      "title": "영상 제목(쇼츠 제목은 짧고 강하게)",
      "altTitles": ["다른 제목 후보 1", "다른 제목 후보 2"],
      "targetLength": "권장 길이(예: 35~45초)",
      "targetViewer": "누가 왜 볼지",
      "thumbnailConcept": "첫 화면(커버)에 보일 장면과 큰 자막",
      "hookIntro": "첫 1~2초에 말할 문장 또는 보여줄 장면",
      "outline": ["0~2초: 훅", "2~10초: ...", "10~30초: ...", "마지막 3초: 반복 시청·댓글 유도"],
      "keyPoints": ["화면 자막·편집 리듬·반복 시청 장치 등 시청 유지 포인트"],
      "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
      "reference": "근거가 된 데이터(영상 번호·패턴)"
    }`,
  long: `    {
      "format": "롱폼",
      "title": "영상 제목",
      "altTitles": ["다른 제목 후보 1", "다른 제목 후보 2"],
      "targetLength": "권장 길이(예: 10~14분)",
      "targetViewer": "누가 왜 볼지",
      "thumbnailConcept": "썸네일 시각 요소와 문구",
      "hookIntro": "첫 30초 오프닝 대본 뼈대",
      "outline": ["00:00 오프닝", "01:00 ...", "05:00 ...", "09:00 ...", "마무리·다음 영상 유도"],
      "keyPoints": ["중간 이탈을 막는 장치(예고·반전·체크리스트 등)"],
      "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
      "reference": "근거가 된 데이터(영상 번호·패턴)"
    }`
};

function buildPrompt(keyword, videos, format = 'all', trends = null) {
  const pick = pickPromptVideos(videos, format);
  const lines = pick.picked.map(videoLine).join('\n');
  const rule = '떡상 영상 = 조회수 1만 회 이상이면서 그 채널 평소 조회수의 3배 이상';
  const intro = pick.supplemented
    ? `아래는 실제 검색 영상입니다(${rule}). 떡상 영상이 적은 형식은 조회수 상위 영상으로 채웠으니 "떡상" 표시 영상에 더 무게를 두세요.`
    : `아래는 실제 검색 영상 중 떡상 영상(${rule})을 배수 순으로 고른 것입니다.`;

  let task;
  let planSchema;
  let extra = '';
  if (format === 'all') {
    task = `쇼츠와 롱폼을 모두 다루세요. recommendations 는 쇼츠 2개, 롱폼 2개로 정확히 4개를 쓰고, outline 은 3~4단계로 간결하게 쓰세요.${pick.shortsCount === 0 ? ' 쇼츠 데이터가 없으면 쇼츠 기획안은 검색 키워드와 롱폼 데이터에서 추론했다고 reference 에 밝히세요.' : ''}${pick.longCount === 0 ? ' 롱폼 데이터가 없으면 롱폼 기획안은 추론했다고 reference 에 밝히세요.' : ''}`;
    planSchema = `${PLAN_SCHEMA.shorts},\n${PLAN_SCHEMA.long}`;
    extra = '\n  "formatStrategy": "이 키워드에서 쇼츠와 롱폼을 어떻게 나눠 운영할지(어느 쪽을 먼저, 서로 어떻게 연결할지) 2~3문장",';
  } else {
    const label = format === 'shorts' ? '쇼츠' : '롱폼';
    task = `${label}만 다루세요. 다른 형식은 언급하지 마세요. recommendations 는 ${label} 기획안 정확히 3개이며, outline 은 ${format === 'shorts' ? '초 단위 장면 4~6컷' : '시간 표시가 있는 구성 5~7단계'}로 바로 촬영할 수 있게 구체적으로 쓰세요.`;
    planSchema = format === 'shorts' ? PLAN_SCHEMA.shorts : PLAN_SCHEMA.long;
  }

  const stats = trendSummary(trends, format);
  return `당신은 한국 유튜브 시장을 분석하는 콘텐츠 전략가입니다.
검색 키워드: "${sanitize(keyword)}" · 분석 형식: ${FORMAT_LABEL[format] || '전체'}

${stats ? `[검색 결과 통계 — 앱이 계산한 실제 수치]\n${stats}\n\n` : ''}${intro}
<videos>
${lines}
</videos>

이 데이터를 근거로, 이제 막 시작하는 크리에이터가 바로 제작할 수 있는 기획안을 작성하세요.
- ${task}
- 데이터에 없는 수치를 지어내지 마세요. 수치를 말할 때는 위 통계와 영상 정보에 있는 값만 쓰세요.
- 모든 문장은 자연스러운 한국어로 쓰세요.
- 출력은 아래 스키마의 JSON 객체 하나만 쓰세요. 코드블록·설명·인사말을 붙이지 마세요.

{
  "summary": "이 키워드에서 조회수가 터지는 핵심 패턴 한 문장",
  "hookingAngles": ["시청자를 끈 패턴과 이유 1", "패턴과 이유 2", "패턴과 이유 3"],
  "titleFormulas": ["떡상 제목에서 뽑은 제목 공식과 예시 1", "공식 2", "공식 3"],
  "thumbnailPatterns": ["떡상 영상 썸네일·첫 화면에서 반복되는 요소 1", "요소 2"],${extra}
  "recommendations": [
${planSchema}
  ],
  "blueOceanInsight": "대형 채널과 겹치지 않는 틈새 공략 각도"
}`;
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

function strList(v, max = 10) {
  return (Array.isArray(v) ? v : []).map(str).filter(Boolean).slice(0, max);
}

function normalizeFormat(f) {
  const s = str(f);
  if (/쇼츠|숏|short/i.test(s)) return '쇼츠';
  if (/롱폼|long|일반/i.test(s)) return '롱폼';
  return s || '기획안';
}

function normalizeReport(obj, format = 'all') {
  if (!obj || typeof obj !== 'object') return null;
  let recommendations = (Array.isArray(obj.recommendations) ? obj.recommendations : [])
    .filter(r => r && typeof r === 'object')
    .map(r => ({
      format: normalizeFormat(r.format),
      title: str(r.title),
      altTitles: strList(r.altTitles, 3),
      targetLength: str(r.targetLength),
      targetViewer: str(r.targetViewer),
      thumbnailConcept: str(r.thumbnailConcept),
      hookIntro: str(r.hookIntro),
      outline: strList(r.outline, 8),
      keyPoints: strList(r.keyPoints, 5),
      tags: strList(r.tags, 12).map(t => t.replace(/^#/, '')),
      reference: str(r.reference)
    }))
    .filter(r => r.title);
  // 한 형식만 요청했는데 다른 형식이 섞여 오면 버린다
  if (format === 'shorts') recommendations = recommendations.filter(r => r.format !== '롱폼');
  if (format === 'long') recommendations = recommendations.filter(r => r.format !== '쇼츠');
  const report = {
    summary: str(obj.summary),
    hookingAngles: strList(obj.hookingAngles, 5),
    titleFormulas: strList(obj.titleFormulas, 5),
    thumbnailPatterns: strList(obj.thumbnailPatterns, 4),
    formatStrategy: format === 'all' ? str(obj.formatStrategy) : '',
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

async function generateStrategy({ engine = 'claude', customPath = '', keyword, videos, workDir, format = 'all' }) {
  if (!videos || videos.length === 0) {
    throw new AiCliError('분석할 영상 데이터가 없습니다.', 'NO_DATA');
  }
  if (pickPromptVideos(videos, format).picked.length === 0) {
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
  const prompt = buildPrompt(keyword, videos, format, computeTrends(videos, format));
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

      const report = normalizeReport(extractJsonObject(text), format);
      if (!report) {
        return reject(new AiCliError('AI 응답을 기획안 형식으로 해석하지 못했습니다. [다시 생성]을 눌러 주세요.', 'BAD_FORMAT', text.slice(0, 3000)));
      }
      const basis = pickPromptVideos(videos, format);
      resolve({ ...report, format, engine: engineName, basisCount: basis.picked.length, basisSupplemented: basis.supplemented, basisShorts: basis.shortsCount, basisLong: basis.longCount });
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
