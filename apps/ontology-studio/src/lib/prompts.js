// AI 로 추출하기: API 키 없이, 프롬프트를 복사해 Claude 앱에 붙여넣고 답(JSON)을 다시 붙여넣는 방식
import { looksLikeAiPayload, aiPayloadToFragment } from './parse/json.js';

export function extractionPrompt(project, text) {
  const classes = project.classes.map(c => `- ${c.name}${c.description ? `: ${c.description}` : ''}`).join('\n') || '- (아직 없음 — 적절히 만들어 주세요)';
  const rels = project.relTypes.map(t => `- ${t.name}${t.description ? `: ${t.description}` : ''}`).join('\n') || '- (아직 없음 — 적절히 만들어 주세요)';
  return `아래 <text> 에서 지식 그래프(온톨로지)를 추출해 주세요.

<rules>
1. 등장하는 사람·조직·장소·사물·개념·사건을 엔티티로, 그 사이의 사실을 관계로 뽑아요.
2. 아래 기존 클래스와 관계 이름을 최대한 재사용하고, 꼭 필요할 때만 새로 만들어요.
3. 관계 이름은 짧은 동사형 한국어로(예: 소속, 참여, 위치, 원인), 방향은 "from 이 to 를 ~한다"로 읽히게.
4. 같은 대상은 한 번만 만들고, id 는 짧고 고유하게(예: p1, org-acme).
5. 글에 없는 사실은 만들지 말고, 날짜·수치 같은 값은 props 에 넣어요.
6. 답은 설명 없이 JSON 하나만 출력해요.
</rules>

<existing_classes>
${classes}
</existing_classes>

<existing_relations>
${rels}
</existing_relations>

<output_format>
{
  "classes": [{ "name": "클래스", "description": "한 줄 정의" }],
  "relationTypes": [{ "name": "관계", "description": "한 줄 정의" }],
  "entities": [{ "id": "p1", "class": "사람", "label": "이름", "props": { "키": "값" } }],
  "relations": [{ "from": "p1", "type": "소속", "to": "org1" }]
}
</output_format>

<text>
${text.trim()}
</text>`;
}

// AI 답에서 JSON 만 골라낸다(앞뒤 설명, \`\`\`json 울타리 허용)
export function parseAiAnswer(answer) {
  const s = String(answer || '').trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidates = [fenced, s, s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)].filter(Boolean);
  for (const c of candidates) {
    try {
      const d = JSON.parse(c);
      if (looksLikeAiPayload(d)) return { fragment: aiPayloadToFragment(d, 'AI 추출') };
      if (Array.isArray(d?.entities)) return { error: '엔티티마다 "class" 가 있어야 해요' };
    } catch { /* 다음 후보 */ }
  }
  return { error: 'JSON 을 찾지 못했어요. AI 답 전체를 그대로 붙여넣어 주세요.' };
}
