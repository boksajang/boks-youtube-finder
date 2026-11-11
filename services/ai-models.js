// ==========================================================================
// BOKS YOUTUBE FINDER - AI CLI 모델·추론 수준 목록
// 설정 창을 열 때마다 설치된 CLI 에서 새로 읽어 항상 최신 목록을 보여 준다(토큰 사용 없음).
//   - Codex : `codex debug models`(계정에서 쓸 수 있는 모델과 모델별 추론 수준). 실패하면 ~/.codex/models_cache.json
//   - Claude: 모델 목록 명령이 없어 '항상 그 계열 최신'을 가리키는 별칭(opus·sonnet·haiku, 계정에 따라 fable 등)을 쓰고,
//             추론 수준은 `claude --help` 의 --effort 설명에서 읽는다
// 사용자 홈의 CLI 설정 파일은 읽기만 한다(현재 기본 모델 표시용).
// ==========================================================================

const { execFile } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const isWin = process.platform === 'win32';
// CLI 인자로 들어가므로 셸 특수문자가 없는 값만 허용(예: opus, claude-opus-5-5[1m], gpt-6.1-sol)
const MODEL_RE = /^[A-Za-z0-9._:[\]-]{1,80}$/;
const EFFORT_RE = /^[a-z]{2,12}$/;

const EFFORT_LABEL = { minimal: '최소', low: '낮음 · 빠름', medium: '보통', high: '높음', xhigh: '매우 높음', max: '최대 · 느림', ultra: '울트라 · 가장 느림' };
const CLAUDE_FAMILIES = [
  { id: 'opus', label: 'Opus (최신)', desc: '복잡한 분석에 강한 상위 모델' },
  { id: 'sonnet', label: 'Sonnet (최신)', desc: '속도와 품질의 균형' },
  { id: 'haiku', label: 'Haiku (최신)', desc: '가장 빠르고 사용량이 적음' }
];
const DEFAULT_CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

const effortItem = e => ({ id: e, label: EFFORT_LABEL[e] || e });

/** CLI 를 인자 그대로 실행해 stdout 을 돌려준다(.cmd 는 셸이 필요해 모든 인자를 큰따옴표로 감싼다. 인자는 상수뿐) */
function runText(exe, args, timeout = 15000) {
  return new Promise(resolve => {
    const done = (err, stdout) => resolve(err && !stdout ? '' : String(stdout || ''));
    const opts = { timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 };
    if (isWin && /\.(cmd|bat)$/i.test(exe)) execFile([exe, ...args].map(a => `"${a}"`).join(' '), [], { ...opts, shell: true }, done);
    else execFile(exe, args, opts, done);
  });
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// --- Claude ---

function claudeCurrent() {
  const s = readJson(path.join(os.homedir(), '.claude', 'settings.json')) || {};
  return {
    model: typeof s.model === 'string' && MODEL_RE.test(s.model) ? s.model : '',
    effort: typeof s.effortLevel === 'string' && EFFORT_RE.test(s.effortLevel) ? s.effortLevel : ''
  };
}

/** 계정에 따라 추가로 쓸 수 있는 계열(예: Fable). Claude Code 가 /model 목록용으로 저장해 둔 값에서 계열 이름만 뽑아 별칭으로 쓴다 */
function claudeExtraFamilies() {
  const j = readJson(path.join(os.homedir(), '.claude.json'));
  const list = j && Array.isArray(j.additionalModelOptionsCache) ? j.additionalModelOptionsCache : [];
  const out = [];
  for (const o of list) {
    const m = o && typeof o.value === 'string' ? /^claude-([a-z]+)-/.exec(o.value) : null;
    const fam = m ? m[1] : '';
    if (!fam || CLAUDE_FAMILIES.some(f => f.id === fam) || out.some(f => f.id === fam)) continue;
    const name = fam[0].toUpperCase() + fam.slice(1);
    out.push({ id: fam, label: `${name} (최신)`, desc: typeof o.description === 'string' ? o.description.replace(/^[^·]*·\s*/, '').slice(0, 80) : '' });
  }
  return out;
}

async function claudeModels(exe) {
  const help = exe ? await runText(exe, ['--help']) : '';
  const m = /--effort\s+<level>[\s\S]{0,300}?\(([a-z, ]+)\)/.exec(help);
  const efforts = (m ? m[1].split(',').map(s => s.trim()) : DEFAULT_CLAUDE_EFFORTS).filter(e => EFFORT_RE.test(e));
  return {
    found: !!exe,
    source: help ? 'cli' : 'builtin',
    models: [...claudeExtraFamilies(), ...CLAUDE_FAMILIES],
    efforts: efforts.map(effortItem),
    current: claudeCurrent()
  };
}

// --- Codex ---

const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

function codexCurrent() {
  let toml = '';
  try { toml = fs.readFileSync(path.join(codexHome(), 'config.toml'), 'utf8'); } catch { /* 없음 */ }
  // 최상위(첫 [섹션] 이전) 값만 본다
  const top = toml.split(/^\s*\[/m)[0];
  const val = key => { const r = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, 'm').exec(top); return r ? r[1] : ''; };
  const model = val('model');
  const effort = val('model_reasoning_effort');
  return { model: MODEL_RE.test(model) ? model : '', effort: EFFORT_RE.test(effort) ? effort : '' };
}

function normalizeCodexModels(list) {
  return (Array.isArray(list) ? list : [])
    .filter(m => m && typeof m.slug === 'string' && MODEL_RE.test(m.slug) && m.visibility !== 'hide')
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
    .map(m => ({
      id: m.slug,
      label: typeof m.display_name === 'string' && m.display_name ? m.display_name : m.slug,
      desc: typeof m.description === 'string' ? m.description.slice(0, 100) : '',
      efforts: (Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels : [])
        .map(x => x && x.effort).filter(e => typeof e === 'string' && EFFORT_RE.test(e)).map(effortItem),
      defaultEffort: typeof m.default_reasoning_level === 'string' && EFFORT_RE.test(m.default_reasoning_level) ? m.default_reasoning_level : ''
    }));
}

async function codexModels(exe) {
  let models = [];
  let source = 'none';
  if (exe) {
    const txt = await runText(exe, ['debug', 'models'], 20000);
    try { models = normalizeCodexModels(JSON.parse(txt.slice(txt.indexOf('{'))).models); source = 'cli'; } catch { /* 이전 버전 등 */ }
  }
  if (!models.length) {
    const cache = readJson(path.join(codexHome(), 'models_cache.json'));
    models = normalizeCodexModels(cache && cache.models);
    if (models.length) source = 'cache';
  }
  return { found: !!exe, source, models, current: codexCurrent() };
}

/**
 * @param resolve (engine) => Promise<string> 실행 파일 경로(없으면 '')
 */
async function listModels(resolve) {
  const [claudeExe, codexExe] = await Promise.all([resolve('claude'), resolve('codex')]);
  const [claude, codex] = await Promise.all([claudeModels(claudeExe), codexModels(codexExe)]);
  return { claude, codex };
}

/** 저장·실행 전에 값 검사(잘못된 값은 '' = CLI 기본값) */
const safeModel = v => (typeof v === 'string' && MODEL_RE.test(v.trim()) ? v.trim() : '');
const safeEffort = v => (typeof v === 'string' && EFFORT_RE.test(v.trim()) ? v.trim() : '');

module.exports = { listModels, safeModel, safeEffort, _internal: { normalizeCodexModels, claudeExtraFamilies } };
