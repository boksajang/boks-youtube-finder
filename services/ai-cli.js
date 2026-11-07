const { spawn, execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

class AiCliService {
  constructor() {
    this.isWin = os.platform() === 'win32';
  }

  // Auto-detect CLI binary path on Windows or macOS
  detectCliPath(engine) {
    const binaryName = engine === 'codex' ? (this.isWin ? 'codex.cmd' : 'codex') : (this.isWin ? 'claude.cmd' : 'claude');
    try {
      const checkCmd = this.isWin ? `where ${binaryName}` : `which ${binaryName}`;
      const found = execSync(checkCmd, { encoding: 'utf8', timeout: 3000 }).trim();
      if (found) {
        return found.split('\n')[0].trim();
      }
    } catch {
      // not found in PATH
    }

    // Common fallback install locations
    const home = os.homedir();
    const commonPaths = this.isWin ? [
      path.join(home, 'AppData', 'Roaming', 'npm', binaryName),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', binaryName),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', binaryName)
    ] : [
      `/usr/local/bin/${binaryName}`,
      `/opt/homebrew/bin/${binaryName}`,
      path.join(home, '.nvm/versions/node', '**/bin', binaryName),
      path.join(home, '.npm-global/bin', binaryName)
    ];

    for (const p of commonPaths) {
      if (fs.existsSync(p)) return p;
    }

    return binaryName; // fallback to plain binary name
  }

  // Generate recommendation prompt based on outlier videos
  buildPrompt(keyword, videos) {
    const topOutliers = videos
      .sort((a, b) => b.outlierMultiplier - a.outlierMultiplier)
      .slice(0, 8);

    const videoSummaries = topOutliers.map((v, i) => {
      const type = v.isShorts ? '숏폼' : '롱폼';
      return `${i + 1}. [${type}] 제목: "${v.title}" | 채널: ${v.channelTitle} (구독자: ${v.subscriberCountFormatted}) | 조회수: ${v.viewCountFormatted} (구독자 대비 ${v.outlierMultiplier}배 떡상!)`;
    }).join('\n');

    return `
너는 30년 차 베테랑 개발자이자 유튜브 알고리즘을 꿰뚫고 있는 '유튜브 떡상 전략가'다.
사용자가 검색한 키워드는 "${keyword}" 이며, 최근 유튜브에서 구독자 대비 조회수가 폭발한 실제 상위 떡상 영상 데이터는 다음과 같다:

[실제 떡상 아웃라이어 데이터]
${videoSummaries}

위 실전 데이터를 바탕으로, 초보 부업러/크리에이터가 즉시 실행할 수 있는 '떡상 소재 추천 리포트'를 JSON 형식으로 작성하라.
반드시 아래 JSON 스키마를 엄격히 준수하고, 마크다운 코드블록이나 불필요한 사족 없이 순수 JSON 문자열만 출력하라.

{
  "summary": "현재 이 키워드 판의 떡상 트렌드 핵심 한 줄 요약",
  "hookingAngles": [
    "시청자를 사로잡은 첫 번째 후킹 패턴 및 이유",
    "시청자를 사로잡은 두 번째 후킹 패턴 및 이유",
    "시청자를 사로잡은 세 번째 후킹 패턴 및 이유"
  ],
  "recommendations": [
    {
      "format": "롱폼 또는 숏폼",
      "title": "클릭률을 극대화할 추천 영상 제목 후보",
      "thumbnailConcept": "시선을 끄는 썸네일 시각 요소 및 텍스트 카피",
      "hookIntro": "영상 시작 10초 내 시청자 이탈을 막을 오프닝 스크립트 뼈대"
    },
    {
      "format": "롱폼 또는 숏폼",
      "title": "클릭률을 극대화할 추천 영상 제목 후보 2",
      "thumbnailConcept": "썸네일 시각 요소 및 텍스트 카피",
      "hookIntro": "오프닝 스크립트 뼈대"
    },
    {
      "format": "롱폼 또는 숏폼",
      "title": "클릭률을 극대화할 추천 영상 제목 후보 3",
      "thumbnailConcept": "썸네일 시각 요소 및 텍스트 카피",
      "hookIntro": "오프닝 스크립트 뼈대"
    }
  ],
  "blueOceanInsight": "대형 채널과 경쟁을 피하고 초보자가 파고들 수 있는 빈집(블루오션) 앵글"
}
`.trim();
  }

  // Execute CLI asynchronously
  async generateStrategy({ engine = 'claude', customPath = '', keyword, videos }) {
    if (!videos || videos.length === 0) {
      throw new Error('분석할 영상 데이터가 없습니다.');
    }

    const cliExecutable = customPath || this.detectCliPath(engine);
    const prompt = this.buildPrompt(keyword, videos);

    return new Promise((resolve, reject) => {
      let args = [];
      if (engine === 'codex') {
        // Codex CLI execution arguments
        args = ['exec', prompt];
      } else {
        // Claude CLI execution arguments
        args = ['-p', prompt];
      }

      console.log(`[AI-CLI] Executing ${engine} CLI:`, cliExecutable, args.slice(0, 1));

      let stdout = '';
      let stderr = '';

      const child = spawn(cliExecutable, args, {
        shell: true,
        env: { ...process.env }
      });

      child.stdout.on('data', data => {
        stdout += data.toString();
      });

      child.stderr.on('data', data => {
        stderr += data.toString();
      });

      child.on('error', err => {
        reject(new Error(`[${engine.toUpperCase()} CLI 실행 실패] 경로: ${cliExecutable}\n오류: ${err.message}\n환경설정에서 CLI 경로가 올바른지 확인해 주세요.`));
      });

      child.on('close', code => {
        if (code !== 0 && !stdout.trim()) {
          return reject(new Error(`[${engine.toUpperCase()} CLI 비정상 종료 (코드 ${code})]\n${stderr || '출력이 없습니다.'}`));
        }

        try {
          // Extract JSON block if wrapped in markdown fences
          let rawJson = stdout.trim();
          const jsonMatch = rawJson.match(/```json\s*([\s\S]*?)\s*```/) || rawJson.match(/```\s*([\s\S]*?)\s*```/);
          if (jsonMatch) {
            rawJson = jsonMatch[1];
          }
          const parsed = JSON.parse(rawJson);
          resolve(parsed);
        } catch {
          // If JSON parsing fails, return text fallback wrapped in structured shape
          resolve({
            summary: `${keyword} 떡상 소재 AI 분석 결과`,
            hookingAngles: ['데이터 기반 AI 분석 완료'],
            recommendations: [
              {
                format: '추천 기획',
                title: `${keyword} 실전 떡상 가이드`,
                thumbnailConcept: '강렬한 대비의 썸네일',
                hookIntro: stdout.slice(0, 300)
              }
            ],
            blueOceanInsight: stdout
          });
        }
      });
    });
  }
}

module.exports = AiCliService;
