/* ===== 1) 기본 토대: 변수 · 리셋 · 레이아웃 (그동안 빌드에서 누락되어 있던 파일들) ===== */
import "./styles/variables.css";
import "./styles/base.css";
import "./styles/layout.css";

/* ===== 2) 메인 스타일 (전체 화면 대부분을 담당하는 원본 파일) ===== */
import "./styles/style.css";

/* ===== 3) 화면(탭)별 기본 스타일 ===== */
import "./styles/home.css";
import "./styles/progress.css";
import "./styles/roster.css";
import "./styles/assessment.css";
import "./styles/paps.css";
import "./styles/seteuk.css";
import "./styles/photoRegister.css";
import "./styles/output.css";
import "./styles/management.css";

/* ===== 4) 공통 컴포넌트(모달/버튼/폼) ===== */
import "./styles/modal.css";
import "./styles/forms-buttons.css";

/* ===== 5) 반응형(모바일/태블릿) 기본 규칙 ===== */
import "./styles/responsive.css";

/* ===== 6) 분류하기 애매한 기존 보정 ===== */
import "./styles/legacy.css";

/* ===== 7) 이후 순차적으로 쌓인 최종 보정 패치 (뒤로 갈수록 우선 적용) ===== */
import "./styles/peon-v9-mobile-fix.css";
import "./styles/peon-v9-final-mobile-sync.css";
import "./styles/progress-v13-calendar-fix.css";
import "./styles/pwa-calendar-final-fix.css";
import "./styles/home-v13-9-final.css";
import "./styles/roster-v13-10-toolbar.css";
import "./styles/v13-20-query-tablet-fix.css";
import "./styles/PHOTO_REGISTER_OVERLAP_ONLY.css";
import "./styles/v14-2-mobile-only-fix.css";
import "./styles/settings-mobile-compact.css";

/* ===== 8) 최종 화면 안전 보정 (PC·태블릿·휴대폰 잘림 방지) — 반드시 마지막에 로드 ===== */
import "./styles/v14-responsive-all-tabs.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);
