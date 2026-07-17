PE-ON V10 styles 정리·문법 수정본

수정 내용
- src/styles/style.css의 닫히지 않은 @media (max-width:600px) 블록 종료 처리
- 파일 끝의 @media (max-width:768px) 블록 종료 처리
- CSS 중괄호 균형 전체 검사 완료
- 사용하지 않는 _PEON_SAFE_OVERRIDES_ONLY.css.bak 백업 파일 제거
- 그 외 선택자와 기능별 CSS 내용은 변경하지 않음

적용 방법
1. 기존 프로젝트의 src/styles 폴더를 별도로 백업합니다.
2. 이 압축의 styles 폴더 내용을 프로젝트의 src/styles 폴더에 덮어씁니다.
3. 프로젝트 루트에서 아래 명령을 실행합니다.

npm run build
firebase deploy --only hosting

정상 기준
- 빌드 시 Expected "}" to go with "{" 경고가 나오지 않아야 합니다.
