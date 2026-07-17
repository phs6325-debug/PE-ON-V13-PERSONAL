PE-ON V11 중복 파일 정리 및 최종환산표 배치 수정

정리한 중복 경로
- src/src/components/Assessment.jsx 삭제
- src/src/styles/style.css 삭제
- src/styles/styles 전체 중복 폴더 삭제

실제 사용 파일
- src/components/Assessment.jsx
- src/styles/assessment.css

수정 내용
- PC/태블릿: 최종환산표 사용 + 입력 버튼 + 합산점수 그대로 사용을 한 줄 배치
- 좌우 선택 그룹 사이 충분한 간격 적용
- 체크박스와 문구 사이 10px 간격 적용
- 모바일: 두 줄 구조 유지
- 중복된 최종환산표 CSS 선언을 하나의 통합 스타일로 정리

빌드 확인
- npm run build 정상 완료
