# 데이터 분석기 (회귀 분석)

시간별 순시값을 넣으면 회귀식을 찾고, 엑셀(순시값·그래프·함수설명)과 **예측용 모델 파일(JSON)** 을 만든다.
나중에 만들 예측 앱의 기반이 되도록 계산 부분과 화면 부분을 나눠 두었다.

## 파일

| 파일 | 역할 |
|---|---|
| `reader.js` | 표 읽기: 가로·세로 자동 판별, 제목·메모 줄 건너뛰기, 단위 줄 합치기, 시각·날짜 해석 |
| `control.js` | 운전 조작 판단 학습: 운전자 기록 → 판단 규칙(회귀 나무) · 선형 식 · 검증 · 조작 추천 |
| `regression.js` | 회귀 엔진. 화면과 무관한 순수 계산이라 브라우저와 Node에서 모두 돈다 |
| `app.js` | 화면: 입력 읽기, 그래프, 엑셀/모델 파일 만들기 |
| `vendor/exceljs.min.js` | 엑셀 읽기·쓰기 (ExcelJS 4.4.0, MIT) |
| `tests/*.test.js` | 검사: `for f in apps/data-analyzer/tests/*.test.js; do node $f; done` |

## 표 읽기 (`reader.js`)

- 엑셀(.xlsx, 시트 선택 가능), CSV(UTF-8·EUC-KR), 붙여넣기(탭·쉼표·세미콜론·공백)를 읽는다.
- **방향 자동 판별**: 항목이 열(세로)인지 행(가로)인지 점수로 판단한다.
  점수 기준: 첫 줄이 이름(글자)인가, 나머지 칸이 숫자인가, 첫 칸이 시간처럼 늘어나는가, 값 개수가 항목 수보다 많은가. 화면에서 직접 바꿀 수도 있다.
- 칸이 듬성듬성한 위쪽 제목·설명 줄, 아래쪽 메모 줄, 완전히 빈 열은 뺀다.
- 이름 아래 단위 줄(°C, kW)이나 2단 머리글(병합 셀)은 `온도 (°C)`, `온도 외기`처럼 이름에 붙인다.

## 분석 방법

- **시간에 따른 변화**: 항목마다 `y = f(t)`
- **항목 관계**: 「가장 궁금한 값」 y와 다른 항목 x 하나씩 `y = f(x)`, 그리고 상관계수 표
- **다중 선형 회귀**: `y = b0 + Σ bj·xj`
- 함수 후보는 직선, 지수(`a·e^(bx)`), 로그(`a + b·ln x`), 거듭제곱(`a·x^b`), 2차, 3차다.
  지수·로그·거듭제곱은 로그를 취해 직선으로 바꿔서 맞춘다. 그래서 R²는 원래 값 기준으로 따로 계산한다.
- 자동 선택: 수정 R²가 최고값과 0.01 이내인 함수 가운데 가장 단순한 것을 고른다. 화면에서 직접 바꿀 수도 있다.
- **95% 예측 범위**: `ŷ ± t(0.975, df) · σ · √(1 + bᵀ(UᵀU)⁻¹b)`. 변환한 공간에서 계산한 뒤 원래 단위로 되돌린다.
- **검증**: 시간 변화는 뒤쪽 20%, 항목 관계는 5개 중 1개를 숨기고 맞혀 본다. 숨긴 값의 오차(RMSE)와 예측 범위 안에 들어온 비율을 보여준다.
- **상세 통계** (`Regression.details(model)`): 계수별 표준오차·t·p값·95% 신뢰구간, 분산분석표(F 검정),
  AIC/BIC, 더빈-왓슨(자기상관), 자크-베라(정규성), 표준화 잔차(튀는 값), 지렛값·쿡의 거리(영향이 큰 값), 다중 회귀의 VIF(다중공선성).
  같은 데이터로 Python statsmodels와 비교했을 때 1e-9 이내로 일치한다 (테스트에 기준값 포함).
  지수·로그·거듭제곱은 직선으로 바꾼 공간(ln y 등)에서 검정한다.
- 다중 회귀는 함께 쓸 항목을 고를 수 있고, 시간(t)도 설명변수로 넣을 수 있다.
- 계산 안정성: 설명변수를 `u = (g − center) / scale`로 표준화해서 푼다. 3차 계수는 numpy와 1e-12 수준까지 일치한다.

## 운전 조작 판단 (`control.js`)

운전자가 감으로 하던 조작을 기록에서 배워 **규칙과 식으로 형식화**한다. 가스 운전 자동화의 출발점이 될 수 있다.

- **설정**: 조작 항목(MV: 밸브 개도·설정값 등), 판단 근거 항목, 추세 창(예: 5분), 배울 대상(조작량 Δ / 조작 값)을 고른다.
- **시점 가정**: 상태(t−1)를 보고 조작(t)을 했다고 본다. 조작 결과가 상태에 섞이는 것(누수)을 막기 위해서다.
- **특징**: 각 근거 항목의 직전 값과 최근 추세(창만큼 전과의 차이), 현재 조작값을 쓴다.
- **판단 규칙**: 회귀 나무(깊이 3, 잎마다 최소 5건 또는 5%, 전체 오차를 2% 이상 줄일 때만 나눔).
  각 잎은 "만약 ~이면 → 올림 몇 %·내림 몇 %·평균 조작량"으로 표시한다.
- **선형 식**: 다중 회귀에서 p > 0.05인 항을 하나씩 뺀다(단계적 제거).
- **검증**: 시간 순서로 앞 75%를 학습하고 뒤 25%를 맞힌다. 비교 기준은 "조작 안 함"이다.
  - 오차(RMSE)
  - 방향(올림·내림·유지) 맞힘
  - 실제로 조작한 순간의 방향 맞힘
  - 기준보다 오차가 5% 이상 작아야 `learned = true`
- **추천**: `Control.recommend(L, { inputs: { 이름: { now, before } }, mvNow }, { min, max, maxStep })`.
  한계를 넘으면 잘라내고 `clipped`로 알린다.
- **한계와 주의**
  - 운전자의 실수와 습관도 그대로 배운다.
  - 기록에 없는 운전 영역에서는 믿을 수 없다.
  - 운전자가 표에 없는 정보(경보, 지시 등)로 판단했으면 배우지 못한다.
  - 피드백 때문에 상관관계가 실제 공정의 반응과 다를 수 있다.
  - 실제 제어에 연결하기 전에 운전 보조(추천)로 충분히 검증해야 한다.

## 엔진 사용법

```js
// 브라우저: <script src="regression.js"></script> → window.Regression
// Node:     const Regression = require('./regression.js');

const fr = Regression.bestFit(xs, ys, { validate: 'tail' });  // { best, auto, all, x, y, ... }
fr.best.predict(130);        // 예측값
fr.best.interval(130);       // [아래, 위] 95% 예측 범위

const m = Regression.multiRegression('전력', y, [{ name: '외기온도', values: a }, { name: '습도', values: b }]);
m.predict({ 외기온도: 31, 습도: 60 });
```

## 모델 파일 형식 (`회귀모델_YYYYMMDD_HHMM.json`)

```jsonc
{
  "format": "data-analyzer/model", "version": 1, "createdAt": "…",
  "time": {
    "kind": "time",                 // time(시각/날짜) | number(숫자 칸) | index(줄 번호)
    "label": "경과 시간(분)", "unit": "min", "unitSeconds": 60,
    "origin": "13:00",              // t = 0 인 시각 → t = (시각 − origin) / unitSeconds
    "range": [0, 120]
  },
  "variables": [{ "name": "…", "n": 25, "mean": 0, "min": 0, "max": 0 }],
  "target": "냉방전력(kW)",
  "correlation": { "names": ["…"], "r": [[1, 0.9]] },
  "models": [
    {
      "kind": "single", "role": "time",   // role: time(y=f(t)) | pair(y=f(x)) | multi
      "y": "실내온도(°C)", "x": "경과 시간(분)",
      "type": "quad", "typeName": "2차 곡선", "auto": true,
      "formula": "y = 27.89 - 0.1369 * t + …", "excel": "=27.88…+(-0.1369…)*X+…",
      "params": [27.89, -0.1369, 0.0014],  // 사람이 읽는 계수 (아래 표)
      "transform": { "x": "id", "y": "id" },
      "xRange": [0, 120],                   // 이 밖은 외삽(덜 정확)
      "stats": { "r2": 0.99, "adjR2": 0.99, "rmse": 0.1, "n": 25 },
      "validation": { "mode": "tail", "nTrain": 20, "nTest": 5, "rmse": 0.2, "trainRmse": 0.1, "coverage": 1 },
      "core": { "center": 60, "scale": 36, "deg": 2, "coef": [], "cov": [[]], "sigma": 0.1, "df": 22 }
    },
    { "kind": "control", "role": "control", "mv": "밸브개도(%)", "target": "delta", "window": 5, "timing": "state(t-1) -> action(t)",
      "features": [{ "key": "L1", "var": "공급압력(bar)", "kind": "level" }, { "key": "T1", "kind": "trend" }],
      "tree": { "j": 2, "thr": 4.92, "left": { "value": 0.64, "up": 0.54, "down": 0, "n": 28 }, "right": {} },
      "linear": { "use": [1, 2], "model": {} }, "deadband": 0.5, "pick": "tree", "evaluation": {} },
    { "kind": "multi", "role": "multi", "y": "…", "b0": 0, "terms": [{ "name": "…", "coef": 0, "beta": 0, "mean": 0, "sd": 1 }], "stats": {}, "core": {} }
  ]
}
```

| type | 식 | params |
|---|---|---|
| linear / quad / cubic | `a0 + a1·x + a2·x² + a3·x³` | `[a0, a1, …]` |
| exp | `a·e^(b·x)` | `[a, b]` |
| log | `a + b·ln(x)` | `[a, b]` |
| power | `a·x^b` | `[a, b]` |

`core`는 예측값과 예측 범위를 다시 계산하는 데 쓰는 값이다. 예측은 `params`보다 `core`로 하는 편이 수치적으로 안정적이다.
`Regression.deserialize(model)`이 이 둘을 모두 처리한다.
