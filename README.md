# PE-ON V10.0 LTS 최종 UI 재점검 패치

반영 내용
- 홈 본문 중복 박쌤 아이콘/PE-ON 로고 완전 제거
- PC 관리탭 카드 크기 확대 및 펼치기 버튼 정렬 보정
- 모바일/태블릿 왼쪽 메뉴에서 하단 관리 메뉴가 잘리지 않도록 보정
- 왼쪽 메뉴는 스크롤바 없이 한 화면에 들어오도록 조정
- 학생카드 보기 버튼 유의사항 표시를 노란 대각선으로 유지

적용 방법
1. 압축 해제
2. 압축 안의 `src` 폴더를 `C:\Users\phs95\Desktop\pe-on\V9-개인전용` 안에 덮어쓰기
3. 아래 명령 실행

```powershell
cd "C:\Users\phs95\Desktop\pe-on\V9-개인전용"
npm run build
firebase deploy --only hosting
```
