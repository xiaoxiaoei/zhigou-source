# 部署选择（2026-09-09 核对）

## 推荐：免费公开展示 + 本地完整运行

GitHub 保存脱敏源码，GitHub Pages 提供公开项目说明、录屏链接及后续经过审核的演示资源。本地运行完整工作台，模型费用由本人控制。

Pages 是静态托管，不提供 Node.js API，也不运行 LibreOffice。当前展示页不接受密钥，不接收材料，不调用大模型。

官方说明：https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages

## 想在线完整试用

Render 免费 Web Service 可用于短期验证，但空闲 15 分钟会休眠，重新打开有冷启动；休眠、重启和重新部署会丢失临时文件，不适合直接存放教师的重要材料或长期生成任务。本项目还依赖文档转换组件。必须先完成 SECURITY.md 列出的安全改造，再考虑部署完整服务。

官方限制：https://render.com/docs/free

## 教师 / 学生计划

- 教师：可以按真实教师身份申请 GitHub Education。教师权益不等于自动享有 Student Developer Pack 的所有学生云额度。
  https://docs.github.com/en/education/about-github-education/github-education-for-teachers/apply-to-github-education-as-a-teacher
- 在读且满足资格的学生：Azure for Students 提供 100 美元、12 个月可用额度，无需信用卡；具体资格、地区与可用服务以官方页面和账户审核为准。额度不是永久免费服务器。
  https://azure.microsoft.com/en-us/free/students/

学校邮箱不等于学生资格，不应借用学生身份申请。教师如需研究计算资源，可以咨询学校云资源或官方研究资助项目，不能预先保证批准。

## 为什么暂不推荐免费 CPU 运行大模型

该应用的复杂动效生成通常需要较强模型。免费 CPU 主机可以运行网页后端，但不能据此推断它能快速运行高质量大模型；模型费用与网页托管费用应分开估算。
