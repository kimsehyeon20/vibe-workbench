# 🛠️ 바이브코딩 작업대

노트북 없이 **휴대폰의 Claude 앱**으로 앱을 만들고, 만든 앱을 바로 웹 주소로 열어보는 작업대예요.

## 폰으로 새 앱 만들기

1. 휴대폰 Claude 앱 → **Code** 탭
2. 이 저장소(`vibe-workbench`) 선택
3. 만들고 싶은 앱을 말하기 — 예: *"물 마신 양 기록하는 앱 만들어줘"*
   (`/new-app 물 마신 양 기록하는 앱` 처럼 스킬을 직접 불러도 돼요)
4. Claude가 클라우드에서 코딩하고 **PR(변경 요청)** 을 만들어요
5. PR을 **Merge(합치기)** 하면 1~2분 뒤 자동으로 배포돼요
6. 갤러리 주소에서 새 앱을 열어보세요

고칠 때도 똑같아요. *"물 기록 앱에 목표량 설정 추가해줘"* 처럼 말하면 돼요.

## 구조

```
apps/            앱 하나당 폴더 하나
  _template/     새 앱 시작 템플릿 (배포 안 됨)
apps.json        갤러리에 보이는 앱 목록
index.html       갤러리 첫 화면
scripts/         배포용 사이트 조립 스크립트
.github/         자동 배포 설정
CLAUDE.md        Claude가 항상 지키는 규칙
.claude/skills/  필요할 때 꺼내 쓰는 작업 절차 (new-app: 새 앱 만들기)
```

## 처음 한 번만 하는 설정

- [ ] GitHub 저장소 **Settings → Pages → Source** 를 **GitHub Actions** 로 바꾸기
- [ ] [claude.ai/code](https://claude.ai/code) 에서 GitHub 연결하고 이 저장소에 Claude GitHub App 설치하기

> ⚠️ 공개 저장소예요. 비밀번호, API 키 같은 건 절대 올리지 마세요.
> 앱에 입력하는 데이터(메모, 기록 등)는 각자 폰 안에만 저장되고 GitHub에는 올라가지 않아요.
