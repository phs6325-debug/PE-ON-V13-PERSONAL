
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import "../styles/StudentRecordsV10Force.css";

const classes = ["2-1", "2-2", "2-3", "2-4", "2-5"];
const byteOptions = ["300", "500", "700", "800"];

const safeParse = (value, fallback) => {
  try {
    return JSON.parse(value) ?? fallback;
  } catch {
    return fallback;
  }
};

const byteLength = (text) => new Blob([String(text || "")]).size;

const splitMemo = (text) =>
  String(text || "")
    .split(/[\n,，]+/)
    .map((v) => v.trim())
    .filter(Boolean);

const pick = (student, list, salt = "") => {
  if (!list.length) return "";
  const key = `${student?.number || ""}-${student?.name || ""}-${student?.id || ""}-${salt}`;
  const seed = key.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return list[seed % list.length];
};

const fitToByte = (sentences, limit) => {
  const clean = sentences.map((s) => String(s || "").trim()).filter(Boolean);
  const picked = [];

  clean.forEach((sentence) => {
    const next = [...picked, sentence].join(" ");
    if (byteLength(next) <= limit) picked.push(sentence);
  });

  if (picked.length) return picked.join(" ");

  let fallback = clean[0] || "";
  while (byteLength(fallback) > limit && fallback.length > 0) {
    fallback = fallback.slice(0, -1).trim();
  }
  return fallback;
};

const normalizeItemType = (type) => {
  if (type === "자세평가" || type === "참여도") return "choice";
  if (type === "횟수" || type === "시간" || type === "거리") return "number";
  if (type === "직접점수입력") return "direct";
  return type || "direct";
};

const getRuleLabel = (rule) =>
  String(rule?.label ?? rule?.condition ?? rule?.name ?? rule?.grade ?? rule?.level ?? "");

const getRuleScore = (rule) =>
  Number(rule?.score ?? rule?.point ?? rule?.value ?? 0) || 0;

const normalize = (value) => String(value ?? "").replace(/\s/g, "").toLowerCase();

const getItemScore = (item, value) => {
  if (value === undefined || value === null || value === "") return 0;
  const type = normalizeItemType(item.type);
  const text = String(value).trim();
  const numericValue = Number(text);

  if (type === "direct") return Number(value || 0);

  if (type === "choice") {
    if (!Number.isNaN(numericValue) && text !== "") return numericValue;
    const matched = (item.rules || []).find((rule) => normalize(getRuleLabel(rule)) === normalize(value));
    return matched ? getRuleScore(matched) : 0;
  }

  if (type === "number") {
    if (Number.isNaN(numericValue)) return 0;
    const matched = (item.rules || []).find((rule) => {
      const min = rule.min === "" || rule.min === undefined ? -Infinity : Number(rule.min);
      const max = rule.max === "" || rule.max === undefined ? Infinity : Number(rule.max);
      return numericValue >= min && numericValue <= max;
    });
    return matched ? getRuleScore(matched) : numericValue;
  }

  return 0;
};

const negativePatterns = [
  "불성실", "비적극", "비협조", "분위기 저해", "저해", "소극", "산만", "장난",
  "미참여", "참여 부족", "집중 부족", "태도 불량", "수업 방해", "무관심",
  "준비 부족", "노력 부족", "책임 부족", "역할 미흡", "갈등", "규칙 미준수"
];

const growthPatterns = [
  "처음", "초반", "중반", "후반", "점차", "향상", "성장", "변화", "개선",
  "나아짐", "적극", "자신감", "노력", "반복", "연습"
];

const positivePatterns = [
  "리더십", "주장", "협력", "배려", "책임", "격려", "응원", "도움", "소통",
  "정확", "성실", "노력", "적극", "정리", "페어플레이", "자기주도", "전략"
];

const countMatches = (text, patterns) =>
  patterns.reduce((count, pattern) => count + (String(text).includes(pattern) ? 1 : 0), 0);

const getMemoTone = (memoText) => {
  const text = String(memoText || "");
  const negative = countMatches(text, negativePatterns);
  const growth = countMatches(text, growthPatterns);
  const positive = countMatches(text, positivePatterns);

  if (negative >= 2 && positive === 0) return "needsSupport";
  if (negative >= 1 && growth >= 1) return "improving";
  if (negative >= 1) return "mixedSupport";
  if (growth >= 2) return "growth";
  return "positive";
};

const buildSupportSentence = (student, memoWords, evidence) => {
  const memo = memoWords.join(" ");
  const lowScore = evidence?.rate > 0 && evidence.rate < 60;

  if (memo.includes("분위기 저해") || memo.includes("저해") || memo.includes("수업 방해")) {
    return pick(student, [
      "수업 과정에서 모둠 활동의 흐름을 유지하는 데 어려움이 있었으며, 긍정적인 언어와 태도로 수업 분위기 형성에 기여하려는 노력이 필요함.",
      "활동 중 수업 분위기에 영향을 주는 모습이 일부 나타나, 공동의 과제를 수행하는 과정에서 책임감 있는 참여 태도를 기를 필요가 있음.",
      "모둠 활동에서 수업의 흐름을 고려한 태도 조절이 요구되며, 친구들과 함께 과제를 수행하는 과정에서 배려와 협력의 자세를 키워갈 필요가 있음."
    ], "support-atmosphere");
  }

  if (memo.includes("비협조") || memo.includes("갈등")) {
    return pick(student, [
      "모둠 활동에서 협력적인 태도를 지속적으로 유지하는 데 어려움이 있었으나, 친구들과 함께 과제를 해결하는 경험을 통해 공동체 활동의 중요성을 이해할 필요가 있음.",
      "활동 과정에서 자신의 역할을 보다 책임감 있게 수행하고, 모둠원과의 의사소통을 통해 협력적인 참여 태도를 기르는 노력이 요구됨.",
      "팀 활동에서 친구들의 의견을 경청하고 함께 과제를 해결하려는 태도를 보완한다면 더욱 의미 있는 성장이 기대됨."
    ], "support-coop");
  }

  if (memo.includes("불성실") || memo.includes("비적극") || memo.includes("소극") || memo.includes("미참여")) {
    return pick(student, [
      "수업 활동에 참여하였으나 적극성과 지속적인 참여 태도 면에서 보완이 필요하며, 교사의 피드백을 바탕으로 자신의 역할을 수행하려는 노력이 요구됨.",
      "활동 참여가 다소 소극적으로 나타났으나, 기본 과제에 꾸준히 참여하며 수업 과정에 책임감을 가지고 임하려는 태도를 길러갈 필요가 있음.",
      "과제 수행 과정에서 참여 태도가 일정하지 않은 모습이 있었으며, 자신의 역할을 인식하고 끝까지 수행하려는 자세를 보완할 필요가 있음."
    ], "support-attitude");
  }

  if (lowScore) {
    return pick(student, [
      "기초 기능 수행에서 보완할 부분이 있으나, 반복적인 연습과 피드백을 통해 자신의 움직임을 점검하려는 태도가 필요함.",
      "수행 결과에서 보완이 필요한 부분이 나타났으며, 수업 과정에서 기본 기능을 꾸준히 익히려는 노력이 요구됨."
    ], "support-score");
  }

  return pick(student, [
    "수업 과정에서 보완할 점이 일부 나타났으나, 피드백을 바탕으로 자신의 역할을 보다 책임감 있게 수행하려는 노력이 기대됨.",
    "활동 중 부족한 부분을 인식하고 수업에 긍정적으로 참여하려는 태도를 지속적으로 길러갈 필요가 있음."
  ], "support-default");
};

const buildPositiveMemoSentence = (student, memoWords, commonWords) => {
  const joined = [...memoWords, ...commonWords].join(" ");
  const has = (patterns) => patterns.some((p) => joined.includes(p));

  if (has(["주장", "리더", "이끔", "모둠장"])) {
    return pick(student, [
      "주장 역할을 맡아 팀원들의 의견을 조율하고 공동의 목표를 향해 활동을 이끄는 모습을 보임.",
      "모둠을 이끄는 과정에서 팀원들의 참여를 살피고 긍정적인 분위기를 형성하는 데 기여함.",
      "역할 수행 과정에서 책임감을 가지고 활동을 주도하며 팀의 흐름을 안정적으로 이끌었음."
    ], "leadership");
  }

  if (has(["격려", "응원", "분위기", "사기"])) {
    return pick(student, [
      "실수를 반복하는 친구에게 격려와 응원의 말을 건네며 팀의 분위기를 긍정적으로 만드는 데 기여함.",
      "경기 중 긍정적인 언어와 표정으로 친구들의 자신감을 높이고 함께 도전하는 분위기를 형성함.",
      "활동 과정에서 친구를 따뜻하게 격려하며 모둠원들이 끝까지 참여할 수 있도록 도움."
    ], "care");
  }

  if (has(["타격", "정확", "패스", "슛", "기능", "기술"])) {
    return pick(student, [
      "기술 수행의 정확성을 높이기 위해 반복적으로 연습하며 자신의 움직임을 점검하는 태도가 나타남.",
      "기본 기능을 익히는 과정에서 동작의 정확성을 높이기 위해 꾸준히 노력하는 모습이 돋보임.",
      "수행 과정에서 자신의 부족한 점을 인식하고 연습을 통해 기능을 개선하려는 태도를 보임."
    ], "skill");
  }

  if (has(["정리", "준비", "용구", "도구"])) {
    return pick(student, [
      "활동 후 용구를 스스로 정리하고 수업 준비와 마무리에 책임감 있게 참여함.",
      "수업 전후 준비와 정리 활동에 성실하게 참여하며 공동체 활동에 필요한 책임감을 실천함.",
      "용구 정리와 활동 공간 정돈에 자발적으로 참여하여 안전하고 질서 있는 수업 분위기 조성에 기여함."
    ], "responsibility");
  }

  if (has(["도움", "배려", "친구", "협력", "소통"])) {
    return pick(student, [
      "어려움을 겪는 친구를 도우며 함께 과제를 해결하려는 협력적인 태도를 보임.",
      "모둠원들과 의견을 나누고 서로의 역할을 존중하며 협력적으로 활동에 참여함.",
      "친구의 수행 수준을 고려해 함께 연습하고 활동을 이어가는 배려심이 나타남."
    ], "cooperation");
  }

  if (has(["소극", "적극", "변화", "성장", "자신감"])) {
    return pick(student, [
      "수업 초반보다 후반으로 갈수록 자신감을 가지고 적극적으로 참여하는 모습으로 변화함.",
      "처음에는 다소 조심스러운 모습을 보였으나 반복적인 경험을 통해 참여 태도가 점차 적극적으로 변화함.",
      "활동 경험이 쌓일수록 자신감을 키우며 수업에 주도적으로 참여하는 모습이 나타남."
    ], "growth");
  }

  if (memoWords.length) {
    return `교사가 관찰한 ${memoWords.slice(0, 4).join("·")}의 모습이 수업 과정에서 의미 있게 드러남.`;
  }

  return "";
};

const buildGrowthSentence = (growth) => {
  const clean = (value) =>
    String(value || "")
      .trim()
      .replace(/[.。]+$/g, "")
      .replace(/^(수업\s*)?(초반|중반|후반)(에는|에는\s*|에|에서)?\s*/g, "");

  const early = clean(growth?.early);
  const middle = clean(growth?.middle);
  const late = clean(growth?.late);

  if (early && middle && late) {
    return `수업 초반에는 ${early} 모습을 보였으나, 중반에는 ${middle} 과정을 거치며 자신의 수행을 점검하였고, 후반에는 ${late} 모습으로 변화함.`;
  }

  if (early && late) {
    return `수업 초반에는 ${early} 모습을 보였으나, 반복 연습과 피드백을 거치며 후반에는 ${late} 모습으로 발전함.`;
  }

  if (middle && late) {
    return `활동 중 ${middle} 과정을 꾸준히 이어가며, 후반에는 ${late} 모습으로 성장함.`;
  }

  if (early && middle) {
    return `수업 초반의 ${early} 모습을 바탕으로, 중반에는 ${middle} 과정을 거치며 수행을 조절하려는 태도를 보임.`;
  }

  if (late) {
    return `수업 후반에는 ${late} 모습이 나타나며 활동 과정에서 긍정적인 변화를 보임.`;
  }

  if (middle) {
    return `활동 중 ${middle} 과정을 통해 자신의 수행을 점검하고 개선하려는 태도를 보임.`;
  }

  if (early) {
    return `수업 초반에는 ${early} 모습이 관찰되었으며, 이후 활동 과정에서 이를 보완하려는 노력이 나타남.`;
  }

  return "";
};

const buildClosing = (student, tone) => {
  if (tone === "needsSupport") {
    return pick(student, [
      "앞으로 공동체 활동 속에서 책임감 있는 태도와 협력적인 자세를 꾸준히 실천해 나가길 기대함.",
      "수업 과정에서 자신의 행동이 모둠에 미치는 영향을 이해하고 긍정적인 참여 태도를 길러가길 기대함.",
      "지속적인 피드백을 통해 수업 참여 태도와 협력적인 의사소통 능력이 향상되기를 기대함."
    ], "support-closing");
  }

  if (tone === "mixedSupport" || tone === "improving") {
    return pick(student, [
      "보완할 점을 인식하고 수업 과정에서 점차 나아지려는 태도를 보인다면 더욱 긍정적인 성장이 기대됨.",
      "활동 과정에서 나타난 부족한 부분을 개선하며 책임감 있는 참여 태도를 키워가는 모습이 기대됨.",
      "교사의 피드백을 바탕으로 수업 참여 태도를 조절하고 협력적인 활동 경험을 넓혀가고 있음."
    ], "mixed-closing");
  }

  return pick(student, [
    "이를 통해 체육활동에 대한 긍정적인 태도와 공동체 의식을 함께 넓혀가고 있음.",
    "수업 과정에서 기능 향상뿐 아니라 책임감과 협력적 태도의 성장을 보여줌.",
    "과제 수행 과정에서 자신의 변화를 인식하고 함께 성장하려는 태도가 돋보임.",
    "활동 경험을 바탕으로 체육 수업에 대한 자신감과 참여 의지가 향상됨."
  ], "closing");
};

export default function StudentRecords() {
  const year = localStorage.getItem("peon_year") || "2026학년도";
  const semester = localStorage.getItem("peon_semester") || "1학기";

  const studentKey = `peon_${year}_${semester}_students`;
  const assessmentKey = `peon_${year}_${semester}_assessment`;
  const assessmentScoreKey = `peon_${year}_${semester}_assessment_scores`;
  const recordKey = `peon_${year}_${semester}_student_records_v10`;
  const optionKey = `${recordKey}_options`;

  const [cls, setCls] = useState("2-1");
  const [unit, setUnit] = useState(localStorage.getItem(`${recordKey}_unit`) || "협동농구");
  const [length, setLength] = useState("500");
  const [mode, setMode] = useState("student");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [records, setRecords] = useState(() => safeParse(localStorage.getItem(recordKey), {}));
  const [recordOptions, setRecordOptions] = useState(() => safeParse(localStorage.getItem(optionKey), {}));
  const [selectedRecordIds, setSelectedRecordIds] = useState([]);
  const [message, setMessage] = useState("");

  const students = safeParse(localStorage.getItem(studentKey), {});
  const activities = safeParse(localStorage.getItem(assessmentKey), []);
  const scores = safeParse(localStorage.getItem(assessmentScoreKey), {});
  const classStudents = students[cls] || [];
  const selectedStudent = classStudents.find((student) => student.id === selectedStudentId) || classStudents[0];

  useEffect(() => {
    if (!selectedStudentId && classStudents[0]?.id) setSelectedStudentId(classStudents[0].id);
  }, [cls, classStudents, selectedStudentId]);

  useEffect(() => {
    localStorage.setItem(`${recordKey}_unit`, unit);
  }, [unit, recordKey]);

  useEffect(() => {
    localStorage.setItem(recordKey, JSON.stringify(records));
  }, [records, recordKey]);

  useEffect(() => {
    localStorage.setItem(optionKey, JSON.stringify(recordOptions));
  }, [recordOptions, optionKey]);

  const getActivityTotal = (student, activity, className = cls) => {
    const items = (activity.items || []).length
      ? activity.items
      : [{ id: "directTotal", name: "평가점수", type: "direct", score: activity.score, rules: [] }];

    return items.reduce((sum, item) => {
      const value = scores?.[activity.id]?.[className]?.[student.id]?.[item.id];
      return sum + getItemScore(item, value);
    }, 0);
  };

  const getStudentEvidence = (student, className = cls) => {
    const rows = activities.map((activity) => ({
      name: activity.name,
      score: getActivityTotal(student, activity, className),
      max: Number(activity.score || 0)
    }));

    const entered = rows.filter((row) => row.score > 0);
    const total = entered.reduce((sum, row) => sum + row.score, 0);
    const max = entered.reduce((sum, row) => sum + row.max, 0);
    const rate = max ? Math.round((total / max) * 100) : 0;
    const best = [...entered].sort((a, b) => b.score - a.score)[0];
    const weak = [...entered].sort((a, b) => a.score - b.score)[0];

    return { rows, entered, total, max, rate, best, weak };
  };

  const getClassOption = (className = cls) => recordOptions?.[className]?._class || {};
  const getStudentOption = (student, className = cls) => recordOptions?.[className]?.[student?.id] || {};

  const updateClassOption = (patch) => {
    setRecordOptions((prev) => ({
      ...prev,
      [cls]: {
        ...(prev[cls] || {}),
        _class: { ...(prev?.[cls]?._class || {}), ...patch }
      }
    }));
  };

  const updateStudentOption = (studentId, patch) => {
    setRecordOptions((prev) => ({
      ...prev,
      [cls]: {
        ...(prev[cls] || {}),
        [studentId]: { ...(prev?.[cls]?.[studentId] || {}), ...patch }
      }
    }));
  };

  
const getStudentProfile = (memoText, evidence) => {
  const text = String(memoText || "");
  const has = (...words) => words.some((word) => text.includes(word));
  const rate = Number(evidence?.rate || 0);

  if (has("주장", "리더", "모둠장", "이끔", "리더십")) return "leader";
  if (has("격려", "응원", "배려", "도움", "친구")) return "caring";
  if (has("용구", "정리", "준비", "책임", "성실")) return "responsible";
  if (has("도전", "포기하지", "끝까지", "노력", "반복")) return "effort";
  if (has("빠르게", "습득", "운동능력", "기능 우수", "기술 우수") || rate >= 90) return "skilled";
  if (has("향상", "성장", "개선", "자신감") || (rate > 0 && rate < 75)) return "growth";
  return "balanced";
};

const buildProfileOpening = (student, profile, unitName) => {
  const pools = {
    skilled: [
      `기본 운동능력이 뛰어난 학생으로 ${unitName} 기술을 빠르게 습득하며 안정적인 수행을 보임.`,
      `운동 감각이 우수하고 ${unitName}의 핵심 기능을 빠르게 이해하여 실제 활동에 능숙하게 적용함.`,
      `신체 조절 능력과 운동 기능이 뛰어나 ${unitName} 활동의 기술을 짧은 시간 안에 익히는 모습이 돋보임.`
    ],
    leader: [
      `${unitName} 활동에서 자신의 역할을 책임감 있게 수행하며 모둠의 흐름을 이끄는 리더십이 돋보임.`,
      `모둠 활동에서 구성원의 참여를 살피고 공동의 목표를 향해 활동을 조율하는 능력이 우수함.`,
      `주도적으로 역할을 수행하면서도 친구들의 의견을 존중하여 협력적인 분위기를 형성함.`
    ],
    caring: [
      `${unitName} 활동에서 친구들을 배려하고 격려하며 긍정적인 수업 분위기를 만드는 데 기여함.`,
      `모둠원의 어려움을 살피고 따뜻한 말과 행동으로 도움을 주는 협력적 태도가 돋보임.`,
      `친구의 실수를 자연스럽게 받아들이고 응원하며 함께 성장하려는 공동체 의식을 보임.`
    ],
    responsible: [
      `${unitName} 수업에 성실하게 참여하며 준비와 정리, 역할 수행에 책임감 있는 태도를 보임.`,
      `맡은 과제를 끝까지 수행하고 수업 전후의 준비와 정리에도 자발적으로 참여함.`,
      `수업 규칙을 잘 지키고 자신의 역할을 꾸준히 수행하는 성실한 태도가 돋보임.`
    ],
    effort: [
      `${unitName} 활동에서 어려운 과제도 포기하지 않고 반복 연습을 이어가는 끈기 있는 태도를 보임.`,
      `기능 향상을 위해 꾸준히 연습하며 자신의 부족한 부분을 스스로 보완하려 노력함.`,
      `실수가 있어도 다시 도전하며 과제를 끝까지 수행하는 성실한 자세가 돋보임.`
    ],
    growth: [
      `${unitName} 수업에서 자신의 부족한 점을 인식하고 반복 연습을 통해 수행 능력을 꾸준히 향상시킴.`,
      `처음에는 다소 어려움을 보였으나 피드백을 적극적으로 반영하며 점차 자신감 있는 수행으로 발전함.`,
      `활동 과정에서 실수를 점검하고 수정하며 눈에 띄는 성장과 변화를 보여줌.`
    ],
    balanced: [
      `${unitName} 수업에 꾸준히 참여하며 운동 기능과 협력적 태도를 함께 발전시킴.`,
      `${unitName} 활동의 기본 원리를 이해하고 맡은 과제를 성실하게 수행함.`,
      `다양한 활동에 적극적으로 참여하며 자신의 수행을 점검하고 개선하려는 태도를 보임.`
    ]
  };

  return pick(student, pools[profile] || pools.balanced, `profile-${profile}`);
};

const buildProfileAttitude = (student, profile) => {
  const pools = {
    skilled: [
      "자신의 능력을 과신하지 않고 늘 배우려는 자세를 지니고 있으며 기능 향상을 위해 꾸준히 노력함.",
      "우수한 기능을 바탕으로도 교사의 피드백을 겸허히 수용하며 더 나은 수행을 위해 노력함.",
      "높은 수행 수준에 만족하지 않고 부족한 부분을 스스로 찾아 보완하는 자기주도성이 돋보임."
    ],
    leader: [
      "모둠원의 의견을 경청하고 각자의 강점을 살려 과제를 해결하도록 돕는 책임감 있는 태도를 보임.",
      "활동을 주도하면서도 친구들의 참여를 독려하고 협력적인 분위기를 유지함.",
      "리더 역할을 맡아 구성원 간의 의견을 조율하고 공동의 목표 달성에 기여함."
    ],
    caring: [
      "친구가 실수했을 때 따뜻하게 격려하고 다시 도전할 수 있도록 도움을 주는 모습이 인상적임.",
      "친구의 입장을 배려하며 함께 과제를 해결하려는 태도가 꾸준히 나타남.",
      "긍정적인 언어와 표정으로 모둠의 사기를 높이고 협력적 분위기 형성에 기여함."
    ],
    responsible: [
      "맡은 역할을 끝까지 수행하고 활동 후 용구를 자발적으로 정리하는 등 책임감 있는 태도를 보임.",
      "수업 준비와 마무리에 성실하게 참여하며 공동체 활동에 필요한 기본 태도를 실천함.",
      "정해진 규칙을 잘 지키고 자신의 역할을 꾸준히 수행하는 모습이 안정적임."
    ],
    effort: [
      "반복 연습 과정에서 자신의 동작을 점검하고 피드백을 반영하여 기능을 꾸준히 향상시킴.",
      "어려움이 있어도 포기하지 않고 여러 차례 시도하며 자신감을 높여감.",
      "수행 결과보다 연습 과정에 집중하며 조금씩 발전하는 모습을 보임."
    ],
    growth: [
      "교사의 피드백을 적극적으로 수용하고 자신의 수행을 수정하며 점차 안정적인 모습을 보임.",
      "초기의 어려움을 반복 연습으로 극복하고 수업 후반에는 자신감 있게 과제를 수행함.",
      "자신의 변화 과정을 스스로 인식하고 부족한 부분을 보완하려는 태도가 돋보임."
    ],
    balanced: [
      "교사의 설명과 피드백을 잘 듣고 자신의 수행에 적용하려는 태도가 꾸준히 나타남.",
      "모둠원과 협력하여 과제를 해결하고 맡은 역할을 책임감 있게 수행함.",
      "수업 활동에 성실히 참여하며 기능과 태도 측면에서 고른 성장을 보임."
    ]
  };

  return pick(student, pools[profile] || pools.balanced, `attitude-${profile}`);
};

const makeSentence = (student, className = cls) => {
    const classOption = getClassOption(className);
    const studentOption = getStudentOption(student, className);
    const byteLimit = Number(studentOption.length || length);

    const commonContent = String(classOption.commonContent || "").trim();
    const memoText = String(studentOption.memo || studentOption.customKeywords || "").trim();
    const commonWords = splitMemo(commonContent);
    const memoWords = splitMemo(memoText);
    const tone = getMemoTone(memoText);
    const evidence = getStudentEvidence(student, className);
    const profile = getStudentProfile(memoText, evidence);

    const unitName = unit || commonWords[0] || "체육";
    const bestName = evidence.best?.name || unitName;
    const weakName = evidence.weak?.name || "기초 기능";

    const opening = buildProfileOpening(student, profile, unitName);
    const attitude = buildProfileAttitude(student, profile);
    const growthSentence = buildGrowthSentence(studentOption.growth || {});

    const evidenceSentence = !evidence.entered.length
      ? ""
      : evidence.rate >= 90
      ? pick(student, [
          `${bestName} 활동에서 핵심 동작을 정확하게 이해하고 상황에 맞게 적용하여 높은 수준의 수행을 보임.`,
          `${bestName} 과제에서 안정적인 기능과 빠른 판단력을 바탕으로 완성도 높은 수행을 보여줌.`,
          `${bestName} 활동의 원리를 정확히 이해하고 실제 상황에 효과적으로 적용하는 능력이 우수함.`
        ], "teacher-evidence-high")
      : evidence.rate >= 75
      ? pick(student, [
          `${bestName} 활동에서 기본 기능을 충실히 익히고 반복 연습을 통해 수행의 정확성을 높여감.`,
          `${bestName} 과제의 핵심을 이해하고 교사의 피드백을 적용하여 안정적인 수행으로 발전함.`,
          `${bestName} 활동에 꾸준히 참여하며 기능을 점차 향상시키는 모습이 나타남.`
        ], "teacher-evidence-mid")
      : pick(student, [
          `${weakName} 활동에서 다소 어려움을 보였으나 과제를 끝까지 수행하며 기초 기능을 익히려 노력함.`,
          `${weakName} 수행 과정에서 실수를 점검하고 반복 연습을 통해 부족한 부분을 보완함.`,
          `${weakName} 활동을 통해 자신의 현재 수준을 확인하고 꾸준히 개선하려는 태도를 보임.`
        ], "teacher-evidence-low");

    const memoSentence = tone === "needsSupport" || tone === "mixedSupport"
      ? buildSupportSentence(student, memoWords, evidence)
      : buildPositiveMemoSentence(student, memoWords, commonWords);

    const closing = tone === "needsSupport"
      ? pick(student, [
          "교사의 안내를 바탕으로 자신의 참여 태도를 돌아보고 책임감 있게 활동하려는 노력을 이어감.",
          "피드백을 수용하며 협력적 태도와 자기조절 능력을 차근차근 길러가는 모습이 나타남.",
          "자신의 보완점을 인식하고 다음 활동에서 이를 개선하려는 태도를 보임."
        ], "teacher-closing-support")
      : pick(student, [
          "운동 기능뿐 아니라 책임감, 협력, 자기점검 능력이 함께 성장하는 모습이 인상적임.",
          "수업을 통해 자신의 강점을 더욱 발전시키고 부족한 부분을 꾸준히 보완하는 태도가 돋보임.",
          "배운 내용을 다음 활동에 적용하며 지속적으로 성장하려는 자세가 우수함.",
          "기능 향상과 더불어 성실하고 협력적인 수업 태도가 꾸준히 나타남."
        ], "teacher-closing-positive");

    return fitToByte(
      [opening, attitude, evidenceSentence, growthSentence, memoSentence, closing],
      byteLimit
    );
  };

  const saveRecords = (next) => {
    setRecords(next);
    localStorage.setItem(recordKey, JSON.stringify(next));
  };

  const updateRecord = (studentId, value) => {
    saveRecords({ ...records, [cls]: { ...(records[cls] || {}), [studentId]: value } });
  };

  const cancelCurrentRecord = () => {
    if (!selectedStudent) return;
    const nextClassRecords = { ...(records[cls] || {}) };
    nextClassRecords[selectedStudent.id] = "";
    saveRecords({ ...records, [cls]: nextClassRecords });
    setMessage(`${selectedStudent.name} 생성 문구를 취소했습니다.`);
  };

  const deleteCurrentRecord = () => {
    if (!selectedStudent) return;
    if (!window.confirm(`${selectedStudent.name} 학생의 생성된 세특 문구를 삭제할까요?\n학생별 메모와 성장 과정은 유지됩니다.`)) return;
    const nextClassRecords = { ...(records[cls] || {}) };
    delete nextClassRecords[selectedStudent.id];
    saveRecords({ ...records, [cls]: nextClassRecords });
    setMessage(`${selectedStudent.name} 생성 문구를 삭제했습니다.`);
  };

  const saveCurrentRecord = () => {
    saveRecords(records);
    setMessage("현재 교과세특 내용을 저장했습니다.");
  };

  const generateOne = (student = selectedStudent) => {
    if (!student) return;
    const text = makeSentence(student);
    saveRecords({ ...records, [cls]: { ...(records[cls] || {}), [student.id]: text } });
    setMessage(`${student.name} 교과세특 문구를 생성했습니다.`);
  };

  const selectedStudents = classStudents.filter((student) => selectedRecordIds.includes(student.id));

  const generateTargets = (targets) => {
    if (!targets.length) return;
    const classRecords = { ...(records[cls] || {}) };
    targets.forEach((student) => {
      classRecords[student.id] = makeSentence(student, cls);
    });
    saveRecords({ ...records, [cls]: classRecords });
    setMessage(`${cls} ${targets.length}명 교과세특 문구를 생성했습니다.`);
  };

  const generateAll = () => generateTargets(classStudents);
  const generateSelected = () => generateTargets(selectedStudents.length ? selectedStudents : classStudents);

  const deleteSelected = () => {
    const targets = selectedStudents.length ? selectedStudents : classStudents;
    if (!targets.length) return;
    if (!window.confirm(`${targets.length}명 교과세특 문구를 삭제할까요?`)) return;
    const nextClassRecords = { ...(records[cls] || {}) };
    targets.forEach((student) => delete nextClassRecords[student.id]);
    saveRecords({ ...records, [cls]: nextClassRecords });
    setMessage(`${targets.length}명 교과세특 문구를 삭제했습니다.`);
  };

  const copySelected = async () => {
    const targets = selectedStudents.length ? selectedStudents : classStudents;
    const text = targets
      .map((student) => `${student.number}. ${student.name} ${records?.[cls]?.[student.id] || ""}`.trim())
      .filter(Boolean)
      .join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setMessage("문구를 복사했습니다.");
    } catch {
      setMessage("복사에 실패했습니다.");
    }
  };

  const downloadExcel = () => {
    const rows = classStudents.map((student) => ({
      번호: student.number,
      이름: student.name,
      학생별메모: getStudentOption(student).memo || "",
      초반: getStudentOption(student).growth?.early || "",
      중반: getStudentOption(student).growth?.middle || "",
      후반: getStudentOption(student).growth?.late || "",
      교과세특: records?.[cls]?.[student.id] || ""
    }));

    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, `${cls}_교과세특`);
    XLSX.writeFile(workbook, `PEON_${year}_${semester}_${cls}_교과세특.xlsx`);
  };

  const toggleRecordSelect = (studentId) => {
    setSelectedRecordIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  };

  const toggleRecordSelectAll = () => {
    setSelectedRecordIds((prev) =>
      prev.length === classStudents.length ? [] : classStudents.map((student) => student.id)
    );
  };

  const stats = useMemo(() => {
    const done = classStudents.filter((student) => records?.[cls]?.[student.id]).length;
    return { total: classStudents.length, done, missing: classStudents.length - done };
  }, [classStudents, records, cls]);

  const classOption = getClassOption();
  const currentText = selectedStudent ? records?.[cls]?.[selectedStudent.id] || "" : "";
  const selectedOption = selectedStudent ? getStudentOption(selectedStudent) : {};
  const selectedEvidence = selectedStudent ? getStudentEvidence(selectedStudent, cls) : null;

  return (
    <div className="page records-page records-v10-page">
      <div className="records-v10-header">
        <div>
          <div className="records-v10-version-badge">V10 NEW STYLE</div>
          <h2>✨ 교과세특</h2>
          <p>학생의 운동 특성, 수업 태도, 성장 과정, 수행평가 근거를 종합해 교사가 직접 작성한 듯한 교과세특 문구를 생성합니다.</p>
        </div>
      </div>

      {message && <div className="assessment-save-message">{message}</div>}

      <section className="card records-v10-toolbar">
        <select value={cls} onChange={(e) => setCls(e.target.value)}>
          {classes.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="단원명 예) 협동농구, 티볼" />
        <select value={length} onChange={(e) => setLength(e.target.value)}>
          {byteOptions.map((option) => <option key={option} value={option}>{option}byte</option>)}
        </select>
        <button className="save-btn records-ai-pro-btn" onClick={generateAll}>✨ AI 전체 생성</button>
        <button className="excel-btn" onClick={downloadExcel}>엑셀 저장</button>
      </section>

      <section className="records-v10-tabs" role="tablist">
        <button className={mode === "student" ? "active" : ""} onClick={() => setMode("student")}>학생별 작성</button>
        <button className={mode === "class" ? "active" : ""} onClick={() => setMode("class")}>학급 전체 생성</button>
      </section>

      {mode === "student" && (
        <section className="sr3-wrap">
          <aside className="sr3-roster">
            <div className="sr3-roster-head">
              <h3>학생 목록 ({stats.total}명)</h3>
              <p>생성 {stats.done} / 미생성 {stats.missing}</p>
            </div>

            <div className="sr3-roster-list">
              {classStudents.map((student) => {
                const done = Boolean(records?.[cls]?.[student.id]);
                return (
                  <button
                    key={student.id}
                    type="button"
                    className={selectedStudent?.id === student.id ? "active" : ""}
                    onClick={() => setSelectedStudentId(student.id)}
                  >
                    <span className="sr3-num">{student.number}</span>
                    <strong>{student.name}</strong>
                    <em className={done ? "done" : ""}>{done ? "●" : "○"}</em>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="sr3-main">
            <section className="sr3-card sr3-evidence">
              <div className="sr3-title">
                <span>1</span>
                <h3>수행평가 근거</h3>
              </div>

              {selectedEvidence?.entered?.length ? (
                <table className="sr3-evidence-table">
                  <tbody>
                    {selectedEvidence.entered.map((row) => (
                      <tr key={row.name}>
                        <th>{row.name}</th>
                        <td>{row.score} / {row.max}</td>
                      </tr>
                    ))}
                    <tr>
                      <th>총점</th>
                      <td>{selectedEvidence.total} / {selectedEvidence.max}</td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <p className="sr3-empty">수행평가 입력 자료가 없습니다.</p>
              )}
            </section>

            <section className="sr3-card sr3-growth">
              <div className="sr3-title">
                <span>2</span>
                <h3>성장 과정</h3>
              </div>

              {selectedStudent && (
                <div className="sr3-growth-grid">
                  <label>
                    <b>수업 초반</b>
                    <input
                      value={selectedOption.growth?.early || ""}
                      onChange={(e) => updateStudentOption(selectedStudent.id, { growth: { ...(selectedOption.growth || {}), early: e.target.value } })}
                      placeholder="예) 타격이 불안정함"
                    />
                  </label>
                  <label>
                    <b>수업 중반</b>
                    <input
                      value={selectedOption.growth?.middle || ""}
                      onChange={(e) => updateStudentOption(selectedStudent.id, { growth: { ...(selectedOption.growth || {}), middle: e.target.value } })}
                      placeholder="예) 반복 연습함"
                    />
                  </label>
                  <label>
                    <b>수업 후반</b>
                    <input
                      value={selectedOption.growth?.late || ""}
                      onChange={(e) => updateStudentOption(selectedStudent.id, { growth: { ...(selectedOption.growth || {}), late: e.target.value } })}
                      placeholder="예) 정확성이 향상됨"
                    />
                  </label>
                </div>
              )}
            </section>

            <section className="sr3-card sr3-memo">
              <div className="sr3-title sr3-title-with-badge">
                <span>3</span>
                <h3>학생별 메모</h3>
                {selectedStudent && <strong>{selectedStudent.number}번 {selectedStudent.name}</strong>}
              </div>

              {selectedStudent && (
                <textarea
                  value={selectedOption.memo || selectedOption.customKeywords || ""}
                  onChange={(e) => updateStudentOption(selectedStudent.id, { memo: e.target.value, customKeywords: e.target.value })}
                  placeholder={"예) 티볼 타격 정확성\n끝까지 노력\n용구 정리 잘함\n또는: 수업태도 불성실, 비적극적, 비협조적"}
                />
              )}
            </section>

            <section className="sr3-card sr3-common">
              <div className="sr3-title">
                <span>4</span>
                <h3>공통 수업 내용</h3>
              </div>

              <textarea
                value={classOption.commonContent || ""}
                onChange={(e) => updateClassOption({ commonContent: e.target.value })}
                placeholder={"예) 협동농구 수업을 통해 주장, 코치, 센터, 포워드, 가드의 역할을 경험함.\n리듬바스켓트레이닝과 3:3 경기 활동을 통해 협력, 배려, 책임감을 기름."}
              />
            </section>

            <section className="sr3-card sr3-result">
              <div className="sr3-title sr3-result-title">
                <span>5</span>
                <h3>AI 생성 결과</h3>
                <div className="sr3-actions-title">
                  <button className="sr3-generate" type="button" onClick={() => generateOne(selectedStudent)}>✨ 생성</button>
                  <button className="sr3-save" type="button" onClick={saveCurrentRecord}>💾 저장</button>
                  <button className="sr3-cancel" type="button" onClick={cancelCurrentRecord}>취소</button>
                  <button className="sr3-delete" type="button" onClick={deleteCurrentRecord}>삭제</button>
                </div>
              </div>

              {selectedStudent && (
                <>
                  <textarea
                    value={currentText}
                    onChange={(e) => updateRecord(selectedStudent.id, e.target.value)}
                    placeholder="AI 생성 결과가 이곳에 표시됩니다."
                  />
                  <div className="sr3-byte">{byteLength(currentText)} / {selectedOption.length || length} byte</div>

                  <div className="sr3-actions">
                    <button className="sr3-generate" type="button" onClick={() => generateOne(selectedStudent)}>✨ 생성</button>
                    <button className="sr3-save" type="button" onClick={saveCurrentRecord}>💾 저장</button>
                    <button className="sr3-cancel" type="button" onClick={cancelCurrentRecord}>취소</button>
                    <button className="sr3-delete" type="button" onClick={deleteCurrentRecord}>삭제</button>
                  </div>
                </>
              )}
            </section>
          </main>
        </section>
      )}

      {mode === "class" && (
        <>
          <section className="card records-v10-common-card">
            <div className="records-v10-section-title"><span>1</span><h3>공통 수업 내용</h3></div>
            <textarea
              value={classOption.commonContent || ""}
              onChange={(e) => updateClassOption({ commonContent: e.target.value })}
              placeholder={"예) 협동농구 수업을 통해 다양한 포지션과 역할을 경험함.\n리듬바스켓트레이닝, 3:3 경기, 모둠 도전과제 등을 수행함."}
            />
          </section>

          <div className="score-summary-row score-summary-row-wide records-summary-sticky records-action-bar">
            <div>전체 <strong>{stats.total}명</strong></div>
            <div>생성 <strong>{stats.done}명</strong></div>
            <div>미작성 <strong>{stats.missing}명</strong></div>
            <div>선택 <strong>{selectedRecordIds.length}명</strong></div>
            <div className="records-action-buttons class-record-main-actions classMobileMainActions">
              <button className="save-btn class-main-action-btn classMobileMainBtn" onClick={generateSelected}>✨ 생성</button>
              <button className="setting-btn class-main-action-btn classMobileMainBtn" onClick={copySelected}>📋 복사</button>
              <button className="delete-btn class-main-action-btn classMobileMainBtn" onClick={deleteSelected}>🗑 삭제</button>
            </div>
          </div>

          <section className="card records-table-card">
            <div className="records-table-wrap">
              <table className="records-class-table records-v10-class-table">
                <colgroup>
                  <col className="col-check" />
                  <col className="col-number" />
                  <col className="col-name" />
                  <col className="col-evidence" />
                  <col className="col-memo" />
                  <col className="col-growth" />
                  <col className="col-result" />
                  <col className="col-byte" />
                </colgroup>
                <thead>
                  <tr>
                    <th><input type="checkbox" checked={classStudents.length > 0 && selectedRecordIds.length === classStudents.length} onChange={toggleRecordSelectAll} /></th>
                    <th>번호</th>
                    <th>이름</th>
                    <th>수행 근거</th>
                    <th>학생별 메모</th>
                    <th>성장 과정</th>
                    <th>생성된 세특</th>
                    <th>byte</th>
                  </tr>
                </thead>
                <tbody>
                  {classStudents.map((student) => {
                    const evidence = getStudentEvidence(student, cls);
                    const text = records?.[cls]?.[student.id] || "";
                    const studentOption = getStudentOption(student);
                    const studentLength = studentOption.length || length;
                    const enteredText = evidence.entered.length
                      ? `${evidence.entered.length}개 · ${evidence.total}/${evidence.max || 0}점`
                      : "수행 근거 없음";

                    return (
                      <tr key={student.id} className={text ? "record-row-done" : "record-row-missing"}>
                        <td className="record-check-cell"><input type="checkbox" checked={selectedRecordIds.includes(student.id)} onChange={() => toggleRecordSelect(student.id)} /></td>
                        <td className="record-number-cell">{student.number}</td>
                        <td className="record-name-cell">{student.name}</td>
                        <td className="record-evidence-cell"><strong>{enteredText}</strong></td>
                        <td>
                          <textarea
                            className="record-student-note"
                            value={studentOption.memo || studentOption.customKeywords || ""}
                            onChange={(e) => updateStudentOption(student.id, { memo: e.target.value, customKeywords: e.target.value })}
                            placeholder="예) 티볼 타격 정확성, 노력, 용구정리"
                          />
                        </td>
                        <td>
                          <div className="records-v10-growth-mini">
                            <input value={studentOption.growth?.early || ""} onChange={(e) => updateStudentOption(student.id, { growth: { ...(studentOption.growth || {}), early: e.target.value } })} placeholder="초반" />
                            <input value={studentOption.growth?.middle || ""} onChange={(e) => updateStudentOption(student.id, { growth: { ...(studentOption.growth || {}), middle: e.target.value } })} placeholder="중반" />
                            <input value={studentOption.growth?.late || ""} onChange={(e) => updateStudentOption(student.id, { growth: { ...(studentOption.growth || {}), late: e.target.value } })} placeholder="후반" />
                          </div>
                        </td>
                        <td>
                          <textarea
                            className="record-result-textarea"
                            value={text}
                            onChange={(e) => updateRecord(student.id, e.target.value)}
                            placeholder="AI 생성을 누르세요."
                          />
                        </td>
                        <td className="record-byte-actions-cell">
                          <div className="record-byte-actions-row">
                            <select className="record-byte-select compact" value={studentLength} onChange={(e) => updateStudentOption(student.id, { length: e.target.value })}>
                              {byteOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                            <div className="record-row-mini-actions">
                              <button type="button" className="mini-generate" onClick={() => generateOne(student)}>생성</button>
                              <button type="button" className="mini-copy" onClick={() => navigator.clipboard?.writeText(text || "")}>복사</button>
                              <button type="button" className="mini-delete" onClick={() => updateRecord(student.id, "")}>삭제</button>
                            </div>
                          </div>
                          <div className={byteLength(text) > Number(studentLength) ? "record-byte-over" : "record-byte-ok"}>
                            {byteLength(text)}byte
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
