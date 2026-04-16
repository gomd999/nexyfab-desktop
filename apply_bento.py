import os

page_tsx_path = r'c:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new\src\app\[lang]\company-introduction\page.tsx'
with open(page_tsx_path, 'r', encoding='utf-8') as f:
    page_content = f.read()

# We will do regular expression replacement for the dict to add the new keys.
import re

def add_dict_keys(lang_block, ctaTitle, ctaDesc, ctaBtn):
    # Just append before the closing brace of the language object
    return re.sub(r'(closingCeo:.*?\n)(\s*})', rf'\1        ctaTitle: "{ctaTitle}",\n        ctaDesc: "{ctaDesc}",\n        ctaBtn: "{ctaBtn}",\n\2', lang_block, flags=re.DOTALL)

ko = r"(ko:\s*{.*?)(closingCeo:.*?\n)(\s*})"
page_content = re.sub(ko, r'\1        ctaTitle: "비즈니스 아이디어를 현실로",\n        ctaDesc: "지금 바로 Nexyfab의 프리미엄 매칭을 경험해보세요.",\n        ctaBtn: "프로젝트 의뢰하기",\n\2\3', page_content, flags=re.DOTALL)

en = r"(en:\s*{.*?)(closingCeo:.*?\n)(\s*})"
page_content = re.sub(en, r'\1        ctaTitle: "Turn Your Business Ideas into Reality",\n        ctaDesc: "Experience Nexyfab\'s premium matching today.",\n        ctaBtn: "Request Expert Consulting",\n\2\3', page_content, flags=re.DOTALL)

ja = r"(ja:\s*{.*?)(closingCeo:.*?\n)(\s*})"
page_content = re.sub(ja, r'\1        ctaTitle: "ビジネスアイデアを現実に",\n        ctaDesc: "今すぐNexyfabのプレミアムマッチングをご体験ください。",\n        ctaBtn: "専門家コンサルティングを申し込む",\n\2\3', page_content, flags=re.DOTALL)

zh = r"(zh:\s*{.*?)(closingCeo:.*?\n)(\s*})"
page_content = re.sub(zh, r'\1        ctaTitle: "将商业理念变为现实",\n        ctaDesc: "立即体验 Nexyfab 的高级匹配。",\n        ctaBtn: "申请专家咨询",\n\2\3', page_content, flags=re.DOTALL)

new_jsx = """
                    {/* ── Eco System Flow ── */}
                    <div className="ci-eco-flow reveal">
                        <div className="ci-eco-node ci-eco-blue">
                            <div className="ci-eco-glow"></div>
                            <div className="ci-eco-node-content">
                                <h4>Nexysys</h4>
                                <p>Sovereign Intelligence<br/>산업 데이터 & AI 지능형 의사결정 체계 구축</p>
                            </div>
                        </div>
                        <div className="ci-eco-arrow">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="#0b5cff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </div>
                        <div className="ci-eco-node ci-eco-indigo">
                            <div className="ci-eco-glow"></div>
                            <div className="ci-eco-node-content">
                                <h4>Nexyfab</h4>
                                <p>End-to-End Orchestration<br/>검증된 제조사 매칭 및 프로젝트 전주기 관리</p>
                            </div>
                        </div>
                    </div>
                    <div className="ci-ceo-content reveal" style={{marginTop: '40px'}}>
                        <div className="ci-ceo-text" style={{textAlign: 'center'}}>
                            <span className="ci-label">{t.ceoLabel}</span>
                            <blockquote className="ci-quote" style={{borderLeft:'none', padding:'0', fontStyle:'italic'}}>{t.ceoQuote}</blockquote>
                            <div className="ci-story" style={{maxWidth:'800px', margin:'0 auto', gap:'10px'}}>
                                <p dangerouslySetInnerHTML={{ __html: t.sec1P2 }} />
                                <p>{t.sec1P3}</p>
                                <p dangerouslySetInnerHTML={{ __html: t.sec1P4 }} />
                            </div>
                        </div>
                    </div>
"""

# replace the old ci-ceo-content with new flow
page_content = re.sub(r'\{\/\* ── Service Quote ── \*\/\}.*?\</div\>\s*\</div\>\s*\</div\>\s*\{\/\* ── Callout Box ── \*\/\}', new_jsx + '\n\n                    {/* ── Callout Box ── */}', page_content, flags=re.DOTALL)


new_bento = """
                    {/* ── Philosophy divider label ── */}
                    <div className="ci-vm-head reveal">
                        <span className="ci-vm-head-tag">{t.vmTitle}</span>
                    </div>

                    {/* ── Bento Grid ── */}
                    <div className="ci-bento-grid reveal">
                        <div className="ci-bento-card ci-bento-large">
                            <div className="ci-bento-glow"></div>
                            <span className="ci-bento-label">{t.visionTitle}</span>
                            <p className="ci-bento-desc">{t.visionDesc}</p>
                        </div>
                        <div className="ci-bento-card">
                            <div className="ci-bento-glow"></div>
                            <span className="ci-bento-label">{t.missionTitle}</span>
                            <p className="ci-bento-desc">{t.missionDesc}</p>
                        </div>
                        <div className="ci-bento-card">
                            <div className="ci-bento-glow"></div>
                            <span className="ci-bento-label">{t.valueTitle}</span>
                            <p className="ci-bento-desc">{t.valueDesc}</p>
                        </div>
                        <div className="ci-bento-card ci-bento-wide">
                            <div className="ci-bento-glow"></div>
                            <span className="ci-bento-label">{t.promiseTitle}</span>
                            <p className="ci-bento-desc">{t.promiseDesc}</p>
                        </div>
                    </div>

                    {/* ── CTA ── */}
                    <div className="ci-cta-section reveal">
                        <h2>{t.ctaTitle}</h2>
                        <p>{t.ctaDesc}</p>
                        <a href={`/${lang}/project-inquiry`} className="ci-glow-btn">{t.ctaBtn}</a>
                    </div>
"""

page_content = re.sub(r'\{\/\* ── Philosophy divider label ── \*\/\}.*?\{\/\* ── Closing ── \*\/\}', new_bento + '\n\n                    {/* ── Closing ── */}', page_content, flags=re.DOTALL)

with open(page_tsx_path, 'w', encoding='utf-8') as f:
    f.write(page_content)


css_path = r'c:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new\src\app\custom.css'
css_append = """
/* ==================================================
   Premium B2B Styles appended by Antigravity
   ================================================== */

.ci-eco-flow {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  margin-bottom: 20px;
}

@media(max-width: 768px) {
  .ci-eco-flow {
    flex-direction: column;
  }
  .ci-eco-arrow svg {
    transform: rotate(90deg);
  }
}

.ci-eco-node {
  position: relative;
  flex: 1;
  max-width: 380px;
  padding: 32px 24px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.4);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.04), inset 0 0 0 1px rgba(255,255,255,0.8);
  text-align: center;
  overflow: hidden;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.ci-eco-node:hover {
  transform: translateY(-5px);
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.08), inset 0 0 0 1px rgba(255,255,255,1);
}

.ci-eco-glow {
  position: absolute;
  top: -50px;
  left: 50%;
  transform: translateX(-50%);
  width: 150px;
  height: 150px;
  border-radius: 50%;
  filter: blur(40px);
  opacity: 0.15;
  z-index: 0;
  transition: opacity 0.3s ease;
}

.ci-eco-node:hover .ci-eco-glow {
  opacity: 0.3;
}

.ci-eco-blue .ci-eco-glow { background: #0b5cff; }
.ci-eco-indigo .ci-eco-glow { background: #4f46e5; }

.ci-eco-node-content {
  position: relative;
  z-index: 1;
}

.ci-eco-node h4 {
  font-size: 24px;
  font-weight: 900;
  margin: 0 0 8px;
  color: #111;
}

.ci-eco-node p {
  font-size: 14.5px;
  color: #555;
  line-height: 1.6;
  margin: 0;
  font-weight: 500;
}

.ci-eco-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #f0f5ff;
  box-shadow: 0 8px 16px rgba(11, 92, 255, 0.1);
}

.ci-bento-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-auto-rows: minmax(180px, auto);
  gap: 20px;
  margin-bottom: 60px;
}

.ci-bento-large {
  grid-column: span 2;
  grid-row: span 2;
}

.ci-bento-wide {
  grid-column: span 2;
}

@media(max-width: 900px) {
  .ci-bento-grid {
     grid-template-columns: 1fr 1fr;
  }
  .ci-bento-large {
     grid-column: span 2;
     grid-row: span 1;
  }
  .ci-bento-wide {
     grid-column: span 2;
  }
}

@media(max-width: 600px) {
  .ci-bento-grid {
     grid-template-columns: 1fr;
  }
  .ci-bento-large, .ci-bento-wide {
     grid-column: span 1;
  }
}

.ci-bento-card {
  position: relative;
  background: #ffffff;
  border-radius: 20px;
  padding: 32px;
  overflow: hidden;
  border: 1px solid rgba(0,0,0,0.06);
  box-shadow: 0 4px 16px rgba(0,0,0,0.03);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  transition: transform 0.3s cubic-bezier(0.165, 0.84, 0.44, 1), box-shadow 0.3s ease;
  cursor: crosshair;
}

.ci-bento-card:hover {
  transform: translateY(-4px) scale(1.01);
  box-shadow: 0 20px 40px rgba(0,0,0,0.08);
}

.ci-bento-glow {
  position: absolute;
  bottom: -40px;
  right: -40px;
  width: 140px;
  height: 140px;
  background: radial-gradient(circle, rgba(99,102,241,0.2) 0%, rgba(255,255,255,0) 70%);
  border-radius: 50%;
  transition: transform 0.4s ease, opacity 0.4s ease;
  opacity: 0.5;
}

.ci-bento-card:hover .ci-bento-glow {
  transform: scale(1.5);
  opacity: 1;
}

.ci-bento-label {
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #4f46e5;
  margin-bottom: 12px;
  position: relative;
  z-index: 2;
}

.ci-bento-desc {
  font-size: 18px;
  font-weight: 700;
  color: #111;
  line-height: 1.5;
  margin: 0;
  position: relative;
  z-index: 2;
  white-space: pre-line;
}

.ci-bento-large .ci-bento-desc {
  font-size: 28px;
}

.ci-cta-section {
  margin: 80px auto 40px;
  max-width: 800px;
  border-radius: 32px;
  background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
  padding: 60px 40px;
  text-align: center;
  box-shadow: 0 32px 64px rgba(15, 23, 42, 0.2);
  position: relative;
  overflow: hidden;
}

.ci-cta-section::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: radial-gradient(circle at 50% 0%, rgba(99,102,241,0.3) 0%, transparent 70%);
  pointer-events: none;
}

.ci-cta-section h2 {
  font-size: 36px;
  font-weight: 900;
  color: #fff;
  margin: 0 0 16px;
}

.ci-cta-section p {
  font-size: 18px;
  color: rgba(255,255,255,0.7);
  margin: 0 0 36px;
}

.ci-glow-btn {
  display: inline-block;
  background: #0b5cff;
  color: #fff;
  font-size: 16px;
  font-weight: 800;
  padding: 18px 40px;
  border-radius: 999px;
  text-decoration: none;
  box-shadow: 0 12px 28px rgba(11, 92, 255, 0.3), inset 0 1px 1px rgba(255,255,255,0.2);
  transition: all 0.3s ease;
  position: relative;
  z-index: 1;
}

.ci-glow-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 20px 40px rgba(11, 92, 255, 0.5), inset 0 1px 1px rgba(255,255,255,0.3);
  background: #256df6;
}
"""

with open(css_path, 'r', encoding='utf-8') as f:
    if 'ci-eco-flow' not in f.read():
        with open(css_path, 'a', encoding='utf-8') as fa:
            fa.write(css_append)
