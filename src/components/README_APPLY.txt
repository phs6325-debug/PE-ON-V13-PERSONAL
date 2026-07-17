PE-ON 진도 입력 팝업 버튼 오른쪽 정렬 패치

적용 방법
1. src/styles/style.css 파일을 엽니다.
2. progress-button-right-fix.css 안의 내용을 style.css 맨 아래에 붙여넣습니다.
3. 저장 후 아래 명령어를 실행합니다.

cd "C:\Users\phs95\Desktop\pe-on\V9-개인전용"

npm run build

firebase deploy --only hosting

수정 내용
- 삭제/저장 버튼을 오른쪽 하단으로 정렬
- 버튼 간격 12px 적용
- PC/태블릿/모바일에서 오른쪽 정렬 유지