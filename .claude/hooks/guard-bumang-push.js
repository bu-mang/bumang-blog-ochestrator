#!/usr/bin/env node
/**
 * PreToolUse(Bash) 가드: bumang-blog 3개 레포는 bu-mang(개인) 소유라
 * gh 활성 계정이 bu-mang이 아니거나 셸에 회사 토큰이 깔려 있으면
 * git push 시 403이 난다. 그 상황을 미리 차단하고 올바른 절차를 안내한다.
 *
 * 종료코드 2 = 툴 호출 차단(stderr가 Claude에게 피드백됨), 0 = 통과.
 */
const { execSync } = require('child_process');

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let cmd = '';
  try {
    cmd = (JSON.parse(raw).tool_input || {}).command || '';
  } catch {
    process.exit(0); // 파싱 실패 시 방해하지 않음
  }

  // `git push` (또는 `git -C <path> push`)가 아니면 통과.
  // `git commit -m "...push..."` 같은 오탐은 피한다.
  const isPush = /(^|[;&|]\s*)git\s+(-C\s+\S+\s+)?push(\s|$|[;&|])/.test(cmd);
  if (!isPush) process.exit(0);

  // 1) 셸에 회사 토큰이 있으면 그게 우선순위라 회사 계정으로 push → 차단
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) {
    console.error(
      '❌ git push 차단: 셸에 GITHUB_TOKEN/GH_TOKEN이 설정돼 있습니다.\n' +
        '   이 토큰(회사 계정)이 gh 키링보다 우선해서 bu-mang 레포에 push 시 403이 납니다.\n' +
        '   → env 토큰을 unset한 뒤 bu-mang으로 진행하거나, /deploy-bumang 스킬을 사용하세요.'
    );
    process.exit(2);
  }

  // 2) gh 활성 계정이 bu-mang인지 확인
  let active = '';
  try {
    const out = execSync('gh auth status 2>&1', { encoding: 'utf8' });
    const lines = out.split('\n');
    for (let i = 0; i < lines.length && !active; i++) {
      const m = lines[i].match(/account ([A-Za-z0-9_-]+)/);
      if (!m) continue;
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        if (/Active account:\s*true/.test(lines[j])) {
          active = m[1];
          break;
        }
        if (/Logged in to/.test(lines[j])) break;
      }
    }
  } catch {
    /* gh 없거나 실패 → 아래에서 불명으로 처리 */
  }

  if (active !== 'bu-mang') {
    console.error(
      `❌ git push 차단: gh 활성 계정이 '${active || '불명'}'입니다.\n` +
        '   bumang-blog 레포는 bu-mang 소유라 이대로 push하면 403이 납니다.\n' +
        "   → 'gh auth switch --user bu-mang' 후 재시도하세요 (완료 후 'gh auth switch --user bhjeong-camfit'로 복귀).\n" +
        '   → 또는 /deploy-bumang 스킬이 전환·push·복귀를 자동으로 처리합니다.'
    );
    process.exit(2);
  }

  process.exit(0); // bu-mang 활성 + env 토큰 없음 → 통과
});
