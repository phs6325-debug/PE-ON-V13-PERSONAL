import { useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { auth, googleProvider } from "./firebase";
import Home from "./components/Home";
import Progress from "./components/Progress";
import Roster from "./components/Roster";
import Assessment from "./components/Assessment";
import Paps from "./components/Paps";
import PrintCenter from "./components/PrintCenter";
import Settings from "./components/Settings";
import StudentRecords from "./components/StudentRecords";
import parksamTeacher from "./assets/parksam-teacher.jpg";

const ALLOWED_EMAIL = "phskch9544@gmail.com";

const navItems = [
  { id: "home", label: "홈", icon: "🏠" },
  { id: "progress", label: "진도", icon: "📚" },
  { id: "roster", label: "명렬표", icon: "👥" },
  { id: "assessment", label: "수행", icon: "🏃" },
  { id: "paps", label: "팝스", icon: "💗" },
  { id: "records", label: "세특", icon: "✨" },
  { id: "print", label: "출력", icon: "🖨️" },
  { id: "settings", label: "관리", icon: "⚙️" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("home");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginError, setLoginError] = useState("");
  const [email, setEmail] = useState(ALLOWED_EMAIL);
  const [password, setPassword] = useState("");
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const handleBeforeInstall = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const handleInstallApp = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const checkAllowed = async (currentUser) => {
    const currentEmail = currentUser?.email || "";
    if (currentEmail !== ALLOWED_EMAIL) {
      await signOut(auth);
      setLoginError("허용된 계정이 아닙니다. PE-ON 관리자 계정으로 로그인하세요.");
      return false;
    }
    return true;
  };

  const handleEmailLogin = async (event) => {
    event?.preventDefault?.();
    setLoginError("");
    if (email.trim() !== ALLOWED_EMAIL) {
      setLoginError("PE-ON에 등록된 이메일만 사용할 수 있습니다.");
      return;
    }
    if (!password) {
      setLoginError("비밀번호를 입력하세요.");
      return;
    }
    try {
      const result = await signInWithEmailAndPassword(auth, email.trim(), password);
      await checkAllowed(result.user);
    } catch {
      setLoginError("이메일 또는 비밀번호를 확인하세요. 처음 사용이면 '계정 만들기'를 먼저 누르세요.");
    }
  };

  const handleCreateEmailAccount = async () => {
    setLoginError("");
    if (email.trim() !== ALLOWED_EMAIL) {
      setLoginError("PE-ON에 등록된 이메일만 계정을 만들 수 있습니다.");
      return;
    }
    if (password.length < 6) {
      setLoginError("비밀번호는 6자 이상으로 입력하세요.");
      return;
    }
    try {
      const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await checkAllowed(result.user);
    } catch {
      setLoginError("이미 계정이 있거나 비밀번호 형식이 맞지 않습니다. 로그인 버튼을 눌러 보세요.");
    }
  };

  const handleGoogleLogin = async () => {
    setLoginError("");
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await checkAllowed(result.user);
    } catch {
      setLoginError("Google 로그인에 실패했습니다. 다시 시도해 주세요.");
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const moveTab = (tabId, subTab = "") => {
    if (tabId === "assessment" && subTab) {
      localStorage.setItem("peon_assessment_default_tab", subTab);
      window.dispatchEvent(new CustomEvent("peon-assessment-tab", { detail: subTab }));
    }
    setActiveTab(tabId);
    setMobileOpen(false);
  };

  const renderPage = () => {
    switch (activeTab) {
      case "home": return <Home onNavigate={moveTab} />;
      case "progress": return <Progress />;
      case "roster": return <Roster />;
      case "assessment": return <Assessment />;
      case "paps": return <Paps />;
      case "print": return <PrintCenter />;
      case "records": return <StudentRecords />;
      case "settings": return <Settings />;
      default: return <Home onNavigate={moveTab} />;
    }
  };

  if (authLoading) {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1>PE-ON</h1>
          <p>로그인 확인 중입니다.</p>
        </div>
      </div>
    );
  }

  if (!user || user.email !== ALLOWED_EMAIL) {
    return (
      <div className="login-page">
        <form className="login-card" onSubmit={handleEmailLogin}>
          <div className="login-mascot-wrap">
            <img src={parksamTeacher} alt="체육교사 박쌤" className="login-mascot-img" />
          </div>
          <h1>🔒 PE-ON</h1>
          <p>체육교사의 모든 기록을 ON</p>
          <span className="peon-version-badge">PE-ON V13.0 PERSONAL</span>
          <p className="login-guide">Chrome 계정과 상관없이 PE-ON 계정으로 로그인할 수 있습니다.</p>
          <div className="email-login-form">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="이메일" autoComplete="username" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호" autoComplete="current-password" />
            <button className="google-login-btn" type="submit">이메일로 로그인</button>
            <button className="setting-btn login-create-btn" type="button" onClick={handleCreateEmailAccount}>처음 1회 계정 만들기</button>
          </div>
          <button className="google-login-btn secondary-login-btn" type="button" onClick={handleGoogleLogin}>Google 계정으로 로그인</button>
          {loginError && <div className="login-error">{loginError}</div>}
        </form>
      </div>
    );
  }

  return (
    <div className={`peon-v9-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}>
      <aside className="peon-v9-sidebar" aria-label="PE-ON 메뉴">
        <div className="peon-v9-side-top">
          <button className="peon-v9-mobile-toggle" type="button" onClick={() => setMobileOpen((value) => !value)} aria-label="모바일 메뉴 열기">☰</button>
          <button className="peon-v9-collapse" type="button" onClick={() => setSidebarCollapsed((value) => !value)} aria-label="메뉴 접기/펼치기">›</button>
        </div>

        <nav className="peon-v9-menu">
          {navItems.map((item) => (
            <button key={item.id} type="button" className={activeTab === item.id ? "active" : ""} onClick={() => moveTab(item.id)} title={item.label}>
              <span className="peon-v9-menu-icon">{item.icon}</span>
              <span className="peon-v9-menu-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="peon-v9-teacher-card peon-v9-version-only">
          <span className="peon-v9-badge">V13.0 PERSONAL</span>
        </div>
      </aside>

      <button className="peon-v9-backdrop" type="button" aria-label="메뉴 닫기" onClick={() => setMobileOpen(false)} />

      <section className="peon-v9-content">
        <header className="peon-v9-topbar">
          <button className="peon-v9-open-mobile" type="button" onClick={() => setMobileOpen(true)} aria-label="메뉴 열기">☰</button>
          <button className="peon-v9-home-quick" type="button" onClick={() => moveTab("home")} title="홈으로">🏠 홈</button>
          <div className="peon-v9-top-brand" aria-label="PE-ON 브랜드">
            <img src={parksamTeacher} alt="체육교사 박쌤" />
            <div>
              <strong>PE-ON</strong>
              <span>체육교사의 모든 기록을 ON</span>
            </div>
          </div>
          <div className="peon-v9-login-bar">
            <span className={`peon-offline-status ${isOnline ? "online" : "offline"}`}>{isOnline ? "온라인" : "오프라인"}</span>
            {installPrompt && <button type="button" onClick={handleInstallApp}>앱 설치</button>}
            <span>{user.email}</span>
            <button onClick={handleLogout}>로그아웃</button>
          </div>
        </header>
        <main className="peon-v9-main">{renderPage()}</main>
      </section>
    </div>
  );
}
