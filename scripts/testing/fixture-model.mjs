export const fixtureDeck = {
    filename: "dynamic-lesson.pptx",
    title: "现象研究",
    slideCount: 2,
    slides: [
      {
        number: 1,
        title: "实验观察",
        paragraphs: [{ text: "温度升高会导致分子运动加快。", bullet: false }],
        tableRows: [], notes: "", media: {}, text: "实验观察\n温度升高会导致分子运动加快。",
      },
      {
        number: 2,
        title: "适用边界",
        paragraphs: [{ text: "结论只适用于给定的实验条件。", bullet: false }],
        tableRows: [], notes: "", media: {}, text: "适用边界\n结论只适用于给定的实验条件。",
      },
    ],
  };
export const stages = [];
export const fixtureClient = {
    configured: true,
    model: "test-model",
    async completeJson({ stage, prompt }) {
      stages.push(stage);
      if (stage.startsWith("课件证据分块")) {
        return { units: [
          { draftTitle: "变化机制", summary: "观察变量之间的方向关系", concepts: ["温度", "分子运动"], logic: ["温度变化影响运动"], slideNumbers: [1], evidence: [{ slideNumber: 1, quote: "温度升高会导致分子运动加快。" }] },
          { draftTitle: "结论边界", summary: "识别结论的适用条件", concepts: ["实验条件"], logic: [], slideNumbers: [2], evidence: [{ slideNumber: 2, quote: "结论只适用于给定的实验条件。" }] },
        ] };
      }
      if (stage === "生成全局教学大纲") {
        return {
          title: "从现象到边界",
          overview: "先理解变化机制，再判断结论边界。",
          outline: [
            { title: "建立变化解释", summary: "识别变量的作用方向", slideNumbers: [1], evidence: [{ slideNumber: 1, quote: "温度升高会导致分子运动加快。" }] },
            { title: "限定结论范围", summary: "明确解释的适用范围", slideNumbers: [2], evidence: [{ slideNumber: 2, quote: "结论只适用于给定的实验条件。" }] },
          ],
          keyPoints: [
            { title: "温度与分子运动的方向关系", visualLabel: "温度作用", explanation: "温度升高推动分子运动加快。", teachingGoal: "看懂变量作用方向", difficulty: "不要把相关误解为无方向关系", importance: "high", slideNumbers: [1], evidence: [{ slideNumber: 1, quote: "温度升高会导致分子运动加快。" }] },
            { title: "实验结论的适用边界", visualLabel: "适用边界", explanation: "结论受给定实验条件限制。", teachingGoal: "能判断结论适用范围", difficulty: "避免过度外推", importance: "medium", slideNumbers: [2], evidence: [{ slideNumber: 2, quote: "结论只适用于给定的实验条件。" }] },
          ],
        };
      }
      if (stage.startsWith("逐知识点分析") && prompt.includes("温度与分子运动")) {
        return {
          coreLogic: "输入变量温度的上升沿着明确方向改变分子运动。",
          teachingQuestion: "温度升高如何影响分子运动？",
          misconception: "把有方向的作用看成并列现象。",
          visualDecision: { shouldAnimate: true, reason: "运动可直接呈现作用由原因向结果传导。", priority: 1 },
        };
      }
      if (stage.startsWith("逐知识点分析")) {
        return {
          coreLogic: "解释必须受原始实验条件约束。",
          teachingQuestion: "这个结论适用于哪里？",
          misconception: "把局部结论推广到所有条件。",
          visualDecision: { shouldAnimate: false, reason: "静态边界标注比运动更清楚。", priority: 4 },
          animation: null,
        };
      }
      if (stage === "跨知识点一致性校验") {
        return { overview: "先解释变量变化，再明确结论边界。", orderedKeyPointIds: ["kp-1", "kp-2"], selectedAnimationIds: ["kp-1"], coherenceNote: "只保留能揭示方向变化的动效。" };
      }
      if (stage === "生成章节教学设计") {
        return { title: "变量变化与结论边界", objectives: ["解释温度对分子运动的影响", "判断结论的适用条件", "区分因果关系与并列现象"], flow: [{ phase: "预测", minutes: 10, teacherAction: "展示温度变化", studentAction: "预测运动变化", studentOutput: "提交方向预测和一条理由", feedback: "统计预测分布并追问错误方向", keyPointIds: ["kp-1"] }, { phase: "边界辨析", minutes: 10, teacherAction: "追问适用条件", studentAction: "说明结论边界", studentOutput: "写出适用与不适用条件", feedback: "对照材料原句核对并纠正外推", keyPointIds: ["kp-2"] }], questions: [{ question: "较弱的旧问题", purpose: "不应优先" }], assessment: [{ prompt: "温度升高后什么发生改变？", answerCue: "分子运动加快", misconception: "把方向关系看成并列", keyPointIds: ["kp-1"] }] };
      }
      if (stage.startsWith("动效视觉蓝图")) {
        return {
          title: "温度与运动", teachingQuestion: "温度升高如何影响分子运动？", teachingCheck: "学生能否根据轨迹变化判断运动速度？", visualMetaphor: "粒子密度与速度的聚散", representationStrategy: "用同一时间窗口内的粒子位移直接表现速度变化，而不是画因果框图。", layoutSafety: "热源、粒子轨迹与对照尺分区放置，彼此保持至少 24 像素净空。", designRationale: "热量脉冲使粒子轨迹逐渐加速。", durationMs: 9000,
          phases: [{ label: "初态", at: 0 }, { label: "加热", at: 0.25 }, { label: "加速", at: 0.55 }, { label: "对照", at: 0.82 }],
          logicSteps: [{ claim: "温度升高", visibleEvidence: "热量输入" }, { claim: "粒子获得更快运动", visibleEvidence: "轨迹变长" }, { claim: "运动速度加快", visibleEvidence: "单位时间位移增大" }],
          motionSequence: [{ at: 0, action: "显示初态", visibleChange: "轨迹较短" }, { at: 0.3, action: "输入热量", visibleChange: "轨迹拉长" }, { at: 0.65, action: "对照速度", visibleChange: "单位时间位移增大" }],
          bindings: [{ svgId: "heat", claim: "温度升高是输入变量", role: "条件" }, { svgId: "particles", claim: "分子运动随温度变化", role: "中间机制" }, { svgId: "outcome", claim: "运动速度加快是结果", role: "结果" }, { svgId: "contrast", claim: "未加热时轨迹较短", role: "反证" }],
          objects: [{ id: "heat", label: "温度" }, { id: "particles", label: "分子" }, { id: "outcome", label: "加快" }],
          misconceptionCorrection: { wrongView: "只是颜色变化", counterEvidence: "对照单位时间位移" },
        };
      }
      if (stage.startsWith("SVG 动效渲染")) return { svgMarkup: '<svg viewBox="0 0 1120 560" xmlns="http://www.w3.org/2000/svg"><style>@keyframes pulse{50%{r:34}}.p{animation:pulse 2s infinite}</style><rect width="1120" height="560" fill="#f8fafc"/><g id="heat" data-phase-index="0"><circle class="p" cx="300" cy="280" r="20" fill="#7659f6"/></g><g id="particles" data-phase-index="1"><circle cx="700" cy="200" r="16" fill="#20bce7"><animate attributeName="cx" values="650;770;650" dur="2s" repeatCount="indefinite"/></circle></g><text id="outcome" data-phase-index="2" x="560" y="500">温度作用</text><path id="contrast" data-phase-index="3" d="M100 450H300" stroke="#333"><animate attributeName="stroke-dashoffset" values="20;0" dur="2s" repeatCount="indefinite"/></path></svg>' };
      throw new Error(`unexpected stage: ${stage}`);
    },
  };

fixtureClient.forModel = () => fixtureClient;

