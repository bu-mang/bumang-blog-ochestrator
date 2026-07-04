#!/usr/bin/env node
/**
 * PostToolUse(Write/Edit) hook: drafts/*.md가 저장되면,
 * 아직 "긴 줄글" 상태인지 검사해서, 그렇다면 Claude에게
 * 사용자의 "분절" 스타일로 다시 정리하라는 지시를 컨텍스트로 주입한다.
 *
 * 이미 분절돼 있으면(한 줄에 문장 하나) 조용히 통과 → 재트리거 루프를 스스로 끊는다.
 * 실제 분절(의미단위 판단)은 모델이 수행한다. 이 스크립트는 "언제 시킬지"만 결정한다.
 */
const fs = require('fs');

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const ti = input.tool_input || {};
  const file = ti.file_path || ti.filePath || '';
  // drafts/ 아래 .md만 대상
  if (!/\/drafts\/[^/]+\.md$/.test(file)) process.exit(0);

  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    process.exit(0);
  }

  // 프론트매터·코드펜스·제목·표·인용·리스트를 뺀 "본문 문단 줄"만 검사한다.
  // 사용자 스타일은 "한두 문장 단위, 줄이 너무 길지 않게"다. 그래서 미분절 판정은
  // 줄이 너무 길거나(>110자) 한 줄에 문장이 3개 이상(=문장경계 2개+)일 때로 잡는다.
  // (2문장을 한 줄에 두는 건 정상 스타일이므로 오탐하지 않는다.)
  const lines = text.split('\n');
  let inFence = false;
  let inFront = false;
  let needs = 0;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (i === 0 && t === '---') { inFront = true; continue; }
    if (inFront) { if (t === '---') inFront = false; continue; }
    if (t.startsWith('```')) { inFence = !inFence; continue; }
    if (inFence || !t) continue;
    if (/^#/.test(t) || /^\|/.test(t) || /^>/.test(t)) continue; // 제목/표/인용
    if (/^([-*+]|\d+\.)\s/.test(t)) continue; // 리스트
    const breaks = (t.match(/[.!?]["')\]]?\s+\S/g) || []).length;
    if (breaks >= 2 || t.length > 110) needs++; // 문장 3개+ 또는 너무 긴 줄
  }

  if (needs < 2) process.exit(0); // 이미 분절됨(또는 대상 아님) → 조용히 통과

  const instruction =
    `방금 저장한 블로그 초안(${file})이 아직 긴 줄글 형태다. ` +
    `이 파일을 사용자의 "분절" 스타일로 다시 정리해서 같은 경로에 저장하라. 규칙:\n` +
    `1) 한 줄이 너무 길지 않게 — 대체로 한두 문장 단위로 끊는다(문장부호는 그대로 줄 끝에 둔다). 짧은 두 문장은 한 줄에 둬도 된다.\n` +
    `2) 한 문장이 길면 그 안에서도 의미단위로 줄을 나눈다. 단, 어색하지 않은 지점(쉼표, 연결어미 '~는데/~지만/~고/~며/~면' 뒤 등)에서만. 애매하면 자르지 말고 한 줄로 둔다.\n` +
    `3) 문단(주제 그룹) 사이의 빈 줄은 그대로 유지한다.\n` +
    "4) 제목(#), 표(|), 코드블록(```), 프론트매터(---), 리스트(-,*,1.)는 건드리지 않는다.\n" +
    `5) 단어와 내용은 절대 바꾸지 말 것 — 오직 줄바꿈만 추가/조정한다.\n` +
    `보정해서 다시 저장하면 된다. 이미 분절된 상태면 이 알림은 다시 뜨지 않는다.`;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: instruction,
      },
    })
  );
  process.exit(0);
});
