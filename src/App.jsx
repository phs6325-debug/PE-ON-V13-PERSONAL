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
  const [swRegistration, setSwRegistration] = useState(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateNotice, setUpdateNotice] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let registrationRef = null;
    let updateTimer = null;
    let reloading = false;

    const watchRegistration = (registration) => {
      registrationRef = registration;
      setSwRegistration(registration);

      if (registration.waiting && navigator.serviceWorker.controller) {
        setUpdateAvailable(true);
      }

      registration.addEventListener("updatefound", () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;
        installingWorker.addEventListener("statechange", () => {
          if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
            setUpdateAvailable(true);
          }
        });
      });
    };

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
        .then((registration) => {
          watchRegistration(registration);
          registration.update().catch(() => {});
          updateTimer = window.setInterval(() => registration.update().catch(() => {}), 30 * 60 * 1000);
        })
        .catch(() => {});

      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloading) return;
        reloading = true;
        window.location.reload();
      });
    }

    const handleVisibility = () => {
      if (document.visibilityState === "visible") registrationRef?.update().catch(() => {});
    };

    const handleBeforeInstall = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (updateTimer) window.clearInterval(updateTimer);
    };
  }, []);


  const showUpdateNotice = (type, message) => {
    setUpdateNotice({ type, message });
    window.setTimeout(() => setUpdateNotice(null), 3500);
  };

  const handleCheckUpdate = async () => {
    if (!isOnline) {
      showUpdateNotice("error", "오프라인 상태에서는 업데이트를 확인할 수 없습니다.");
      return;
    }
    if (!swRegistration) {
      showUpdateNotice("error", "업데이트 기능을 준비하는 중입니다. 잠시 후 다시 눌러 주세요.");
      return;
    }

    setCheckingUpdate(true);
    showUpdateNotice("checking", "업데이트를 확인하고 있습니다.");
    try {
      await swRegistration.update();
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      if (swRegistration.waiting) {
        setUpdateAvailable(true);
        showUpdateNotice("available", "새로운 버전을 찾았습니다. 지금 업데이트를 눌러 적용해 주세요.");
      } else {
        showUpdateNotice("success", "확인 완료: 현재 최신 버전을 사용하고 있습니다.");
      }
    } catch (error) {
      console.error("PE-ON update check failed", error);
      showUpdateNotice("error", "업데이트 확인에 실패했습니다. 인터넷 연결을 확인해 주세요.");
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleApplyUpdate = () => {
    const waitingWorker = swRegistration?.waiting;
    if (!waitingWorker) {
      window.location.reload();
      return;
    }
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  };

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
      case "settings": return <Settings onNavigate={moveTab} />;
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
          <span className="peon-version-badge">PE-ON V14.4 PERSONAL</span>
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
          <span className="peon-v9-badge">V14.4 PERSONAL</span>
          <button type="button" className="peon-sidebar-update-btn" onClick={handleCheckUpdate} disabled={!isOnline || checkingUpdate}>
            {checkingUpdate ? "확인 중" : "↻ 업데이트 확인"}
          </button>
        </div>
      </aside>

      <button className="peon-v9-backdrop" type="button" aria-label="메뉴 닫기" onClick={() => setMobileOpen(false)} />

      <section className="peon-v9-content">
        <header className="peon-v9-topbar">
          <button className="peon-v9-open-mobile" type="button" onClick={() => setMobileOpen(true)} aria-label="메뉴 열기">☰</button>
          <button className="peon-v9-home-quick" type="button" onClick={() => moveTab("home")} title="홈으로">🏠 홈</button>
          <div className="peon-v9-top-brand" aria-label="PE-ON 브랜드">
            <img src={parksamTeacher} alt="체육교사 박쌤" />
            <div className="peon-v9-brand-copy">
              <strong>PE-ON</strong>
              <span className="peon-v9-brand-subtitle">체육교사의 모든 기록을 ON</span>
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


      {updateNotice && (
        <div className={`peon-update-toast ${updateNotice.type}`} role="status" aria-live="polite">
          <span className="peon-update-toast-mark">{updateNotice.type === "success" ? "✓" : updateNotice.type === "error" ? "!" : "↻"}</span>
          <span>{updateNotice.message}</span>
        </div>
      )}

      {updateAvailable && (
        <div className="peon-update-overlay" role="dialog" aria-modal="true" aria-labelledby="peon-update-title">
          <div className="peon-update-card">
            <div className="peon-update-icon">↻</div>
            <h2 id="peon-update-title">새로운 버전이 있습니다</h2>
            <p>업데이트하면 최신 수정사항이 바로 적용됩니다. 저장 중인 내용이 있다면 먼저 저장해 주세요.</p>
            <div className="peon-update-actions">
              <button type="button" className="later" onClick={() => setUpdateAvailable(false)}>나중에</button>
              <button type="button" className="apply" onClick={handleApplyUpdate}>지금 업데이트</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
