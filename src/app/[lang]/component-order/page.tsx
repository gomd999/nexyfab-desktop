'use client';

import React, { useState, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';

const dict = {
  ko: {
    heroKicker: 'Nexyfab · Orders.',
    heroTitle: '부품 단건 발주',
    heroTitleRegular: '부품 정기 발주',
    titleSub: '(Parts Sourcing & Procurement)',
    heroSub: '카테고리를 선택하는 것만으로 부품 구성을 완성하고,<br/> 발주까지 한 번에 진행할 수 있습니다.',
    heroSubRegular: '정기적으로 필요한 부품을 미리 예약하고,<br/> 약속된 주기마다 자동으로 발주를 진행합니다.',
    badge1: 'BOM 카테고리', badge2: '제조·부품', badge3: '정기 배송',
    anchor: '부품 리스트 구성 ↓',
    card1Title: '부품 선택',
    card2Title: 'BOM 장바구니',
    card3Title: '발주 및 배송 정보',
    regCycle: '발주 주기',
    regCyclePl: '예: 매월 1일, 매주 월요일 등',
    cat: '카테고리',
    catPl: '카테고리를 선택해주세요',
    itemName: '부품명',
    itemPl: '먼저 카테고리를 선택하세요',
    customInput: '기타 입력',
    customPl: '직접 입력',
    spec: '규격',
    specPl: '예: M6 · 4040 · 20mm',
    qty: '수량',
    qtyPl: '예: 100',
    addBtn: '➕ BOM 장바구니 추가',
    noItems: '장바구니에 항목이 없습니다.',
    colNo: 'No.',
    colCat: '카테고리',
    colName: '부품명',
    colSpec: '규격',
    colQty: '수량',
    colDelete: '삭제',
    deleteBtn: '삭제',
    orderName: '이름',
    orderCompany: '회사명',
    orderPhone: '전화번호',
    orderEmail: '이메일',
    csvBtn: '📤 CSV',
    submitBtn: '📩 발주 제출',
    alertCat: '카테고리와 부품명을 선택해주세요.',
    alertSuccess: '성공적으로 접수되었습니다.',
    alertRequired: '필수 입력 항목을 모두 채워주세요.',
    alertFailed: '제출에 실패했습니다',
    alertError: '제출 중 오류가 발생했습니다.'
  },
  en: {
    heroKicker: 'Nexyfab · Orders.',
    heroTitle: 'Single Component Order',
    heroTitleRegular: 'Regular Component Order',
    titleSub: '(Parts Sourcing & Procurement)',
    heroSub: 'Complete your component list by just selecting categories,<br/> and proceed to order all at once.',
    heroSubRegular: 'Pre-book components you need regularly and<br/> automatically place orders at scheduled intervals.',
    badge1: 'BOM Categories', badge2: 'Mfg·Parts', badge3: 'Regular Delivery',
    anchor: 'Configure Part List ↓',
    card1Title: 'Select Parts',
    card2Title: 'BOM Cart',
    card3Title: 'Order & Shipping Info',
    regCycle: 'Order Cycle',
    regCyclePl: 'e.g., 1st of every month, every Monday',
    cat: 'Category',
    catPl: 'Please select a category',
    itemName: 'Part Name',
    itemPl: 'Select category first',
    customInput: 'Other',
    customPl: 'Direct input',
    spec: 'Specification',
    specPl: 'e.g., M6 · 4040 · 20mm',
    qty: 'Quantity',
    qtyPl: 'e.g., 100',
    addBtn: '➕ Add to BOM Cart',
    noItems: 'No items in cart.',
    colNo: 'No.',
    colCat: 'Category',
    colName: 'Part Name',
    colSpec: 'Spec',
    colQty: 'Qty',
    colDelete: 'Delete',
    deleteBtn: 'Delete',
    orderName: 'Name',
    orderCompany: 'Company',
    orderPhone: 'Phone',
    orderEmail: 'Email',
    csvBtn: '📤 CSV',
    submitBtn: '📩 Submit Order',
    alertCat: 'Please select both category and part name.',
    alertSuccess: 'Order successfully submitted.',
    alertRequired: 'Please fill in all required fields.',
    alertFailed: 'Failed to submit',
    alertError: 'Error occurred during submission.'
  },
  ja: {
    heroKicker: 'Nexyfab · Orders.',
    heroTitle: '部品単発発주',
    heroTitleRegular: '部品定期発注',
    titleSub: '(Parts Sourcing & Procurement)',
    heroSub: 'カテゴリーを選択するだけで部品構成を完成させ、<br/> 発注まで一度に進めることができます.',
    heroSubRegular: '定期的に必要な部品をあらかじめ予約し、<br/> 決められた周期ごとに自動的に発注を進めます。',
    badge1: 'BOMカテゴリー', badge2: '製造・部品', badge3: '定期配送',
    anchor: '部品リストの構成 ↓',
    card1Title: '部品選択',
    card2Title: 'BOMカート',
    card3Title: '発注および配送情報',
    regCycle: '発注周期',
    regCyclePl: '例: 毎月1日、毎週月曜日など',
    cat: 'カテゴリー',
    catPl: 'カテゴリーを選択してください',
    itemName: '部品名',
    itemPl: 'まずカテゴリーを選択してください',
    customInput: 'その他',
    customPl: '直接入力',
    spec: '規格',
    specPl: '例: M6 · 4040 · 20mm',
    qty: '数量',
    qtyPl: '例: 100',
    addBtn: '➕ BOMカートに追加',
    noItems: 'カートに項目がありません。',
    colNo: 'No.',
    colCat: 'カテゴリー',
    colName: '部品名',
    colSpec: '規格',
    colQty: '数量',
    colDelete: '削除',
    deleteBtn: '削除',
    orderName: '名前',
    orderCompany: '会社名',
    orderPhone: '電話番号',
    orderEmail: 'メール',
    csvBtn: '📤 CSV',
    submitBtn: '📩 発注提出',
    alertCat: 'カテゴリーと部品名を選択してください。',
    alertSuccess: '正常に受け付けられました。',
    alertRequired: '必須入力項目をすべてご記入ください。',
    alertFailed: '提出に失敗しました',
    alertError: '提出中にエラーが発生しました。'
  },
  zh: {
    heroKicker: 'Nexyfab · Orders.',
    heroTitle: '零部件单次订购',
    heroTitleRegular: '零部件定期订购',
    titleSub: '(Parts Sourcing & Procurement)',
    heroSub: '只需选择类别即可完成零件清单，<br/> 并一次性进行订购。',
    heroSubRegular: '预订您定期需要的零部件，<br/> 并按预定的时间间隔自动下单。',
    badge1: 'BOM 类别', badge2: '制造·零件', badge3: '定期配送',
    anchor: '配置零件清单 ↓',
    card1Title: '选择零件',
    card2Title: 'BOM 购物车',
    card3Title: '订购与配送信息',
    regCycle: '订购周期',
    regCyclePl: '例如：每月1日、每周一等',
    cat: '类别',
    catPl: '请选择类别',
    itemName: '零件名称',
    itemPl: '请先选择类别',
    customInput: '其他',
    customPl: '直接输入',
    spec: '规格',
    specPl: '例：M6 · 4040 · 20mm',
    qty: '数量',
    qtyPl: '例：100',
    addBtn: '➕ 添加到 BOM 购物车',
    noItems: '购物车中没有项目。',
    colNo: 'No.',
    colCat: '类别',
    colName: '零件名称',
    colSpec: '规格',
    colQty: '数量',
    colDelete: '删除',
    deleteBtn: '删除',
    orderName: '姓名',
    orderCompany: '公司名称',
    orderPhone: '电话号码',
    orderEmail: '邮箱',
    csvBtn: '📤 CSV',
    submitBtn: '📩 提交订单',
    alertCat: '请选择类别和零件名称。',
    alertSuccess: '订单提交成功。',
    alertRequired: '请填写所有必填项。',
    alertFailed: '提交失败',
    alertError: '提交过程中出现错误。'
  }
};

export default function ComponentOrderPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ComponentOrderContent />
    </Suspense>
  );
}

function ComponentOrderContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const orderType = searchParams.get('type') || 'single';
  const isRegular = orderType === 'regular';

  const langCode = pathname.split('/')[1] || 'en';
  const lang = ['en', 'kr', 'ja', 'cn'].includes(langCode) ? langCode : 'en';
  const langMap: Record<string, string> = { kr: 'ko', en: 'en', ja: 'ja', cn: 'zh', es: 'en', ar: 'en' };
  const strLang = langMap[lang] as 'ko' | 'en' | 'ja' | 'zh';
  const t = dict[strLang];
  const { toast } = useToast();

  const [cart, setCart] = useState<any[]>([]);
  const [selectedCat, setSelectedCat] = useState('');
  const [selectedItem, setSelectedItem] = useState('');
  const [isCustom, setIsCustom] = useState(false);

  // Animation logic for reveal classes
  React.useEffect(() => {
    let observer: IntersectionObserver;
    const raf = requestAnimationFrame(() => {
      observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('active');
          } else {
            entry.target.classList.remove('active');
          }
        });
      }, { threshold: 0.1 });
      document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
    });
    return () => { cancelAnimationFrame(raf); observer?.disconnect(); };
  }, []);

  const bomDataDict = {
    ko: {
      "기타 (직접입력)": [],
      "체결류 / 볼트·너트·기계요소": ["M3 볼트", "M4 볼트", "M5 볼트", "M6 볼트", "M8 볼트", "육각 너트", "사각 너트", "평와셔", "스프링 와셔", "핀 (Pin)", "키 (Key)"],
      "샤프트 / 베어링 / LM가이드": ["연마봉 (열처리 샤프트)", "볼 베어링", "오일리스 베어링", "스러스트 베어링", "니들 베어링", "LM가이드 블록", "LM가이드 레일", "볼스크류", "로드엔드 베어링"],
      "기어류 / 동력전달 부품": ["스퍼 기어", "랙 기어", "베벨 기어", "타이밍 풀리", "타이밍 벨트", "V벨트", "체인", "스프로킷", "커플링", "유니버셜 조인트"],
      "프로파일 / 브라켓 / 지지·지그 요소": ["2020 알루미늄 프로파일", "3030 알루미늄 프로파일", "4040 알루미늄 프로파일", "L 브라켓", "T 브라켓", "조인트 클램프", "베이스 플레이트", "캐스터 (바퀴)", "레벨링 풋", "지그 픽스처"],
      "공압·유압 + 컨베이어 요소": ["공압 실린더", "유압 실린더", "솔레노이드 밸브", "오토스위치", "레귤레이터", "우레탄 튜브", "원터치 피팅", "컨베이어 롤러", "플랫 벨트", "모터 마운트"]
    },
    en: {
      "Other (Direct Input)": [],
      "Fasteners / Bolts·Nuts": ["M3 Bolt", "M4 Bolt", "M5 Bolt", "M6 Bolt", "M8 Bolt", "Hex Nut", "Square Nut", "Flat Washer", "Spring Washer", "Pin", "Key"],
      "Shafts / Bearings / LM Guide": ["Hardened Shaft", "Ball Bearing", "Oilless Bearing", "Thrust Bearing", "Needle Bearing", "LM Guide Block", "LM Guide Rail", "Ball Screw", "Rod End Bearing"],
      "Gears / Power Transmission": ["Spur Gear", "Rack Gear", "Bevel Gear", "Timing Pulley", "Timing Belt", "V-Belt", "Chain", "Sprocket", "Coupling", "Universal Joint"],
      "Profiles / Brackets / Jigs": ["2020 Al Profile", "3030 Al Profile", "4040 Al Profile", "L Bracket", "T Bracket", "Joint Clamp", "Base Plate", "Caster", "Leveling Foot", "Jig Fixture"],
      "Pneumatics·Hydraulics": ["Pneumatic Cylinder", "Hydraulic Cylinder", "Solenoid Valve", "Auto Switch", "Regulator", "Urethane Tube", "One-Touch Fitting", "Conveyor Roller", "Flat Belt", "Motor Mount"]
    },
    ja: {
      "その他（直接入力）": [],
      "締結部品 / ボルト・ナット": ["M3ボルト", "M4ボルト", "M5ボルト", "M6ボルト", "M8ボルト", "六角ナット", "四角ナット", "平ワッシャー", "スプリングワッシャー", "ピン", "キー"],
      "シャフト / ベアリング / LMガイド": ["研磨シャフト", "ボールベアリング", "オイレスベアリング", "スラストベアリング", "ニードルベアリング", "LMガイドブロック", "LMガイドレール", "ボールねじ", "ロッドエンドベアリング"],
      "ギア / 動力伝達部品": ["平歯車", "ラックギア", "ベベルギア", "タイミングプーリー", "タイミングベルト", "Vベルト", "チェーン", "スプロケット", "カップリング", "ユニバーサルジョイント"],
      "プロファイル / ブラケット": ["2020アルミプロファイル", "3030アルミプロファイル", "4040アルミプロファイル", "Lブラケット", "Tブラケット", "ジョイントクランプ", "ベースプレート", "キャスター", "レベリングフット", "ジグフィクスチャー"],
      "空압・油압 ＋ コンベア要素": ["空圧シリンダー", "油圧シ린더", "電磁弁", "オートスイッチ", "レギュレーター", "ウレタン튜브", "ワンタッチ継手", "コンベアローラー", "平ベルト", "モーターマウント"]
    },
    zh: {
      "其他（直接输入）": [],
      "紧固件 / 螺栓·螺母": ["M3 螺栓", "M4 螺栓", "M5 螺栓", "M6 螺栓", "M8 螺栓", "六角螺母", "四角螺母", "平垫圈", "弹簧垫圈", "销 (Pin)", "键 (Key)"],
      "轴 / 轴承 / 直线导轨": ["研磨轴", "滚珠轴承", "无油轴承", "推力轴承", "滚针轴承", "直线导轨滑块", "直线导轨", "滚珠丝杠", "杆端关节轴承"],
      "齿轮 / 动力传动部件": ["正齿轮", "齿条", "伞齿轮", "同步带轮", "同步带", "V型带", "链条", "链轮", "联轴器", "万向节"],
      "铝型材 / 支架 / 夹具": ["2020 铝型材", "3030 铝型材", "4040 铝型材", "L 型支架", "T 型支架", "连接夹", "底板", "脚轮", "地脚", "夹具元件"],
      "气动·液压 + 输送机件": ["气动气缸", "液压气缸", "电磁阀", "自动开关", "调压阀", "聚氨酯气管", "快插接头", "输送滚筒", "平皮带", "电机支座"]
    }
  };

  const BOM_DATA = bomDataDict[strLang];
  const customKey = Object.keys(BOM_DATA)[0];

  const currentItems = selectedCat && BOM_DATA[selectedCat as keyof typeof BOM_DATA] ? BOM_DATA[selectedCat as keyof typeof BOM_DATA] : [];

  const handleCatChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const cat = e.target.value;
    setSelectedCat(cat);
    setSelectedItem('');
    if (cat === customKey) {
      setIsCustom(true);
    } else {
      setIsCustom(false);
    }
  };

  const handleItemChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedItem(e.target.value);
  };

  const handleAddToCart = () => {
    const cat = selectedCat;
    let item = selectedItem;
    const spec = (document.getElementById('specInput') as HTMLInputElement)?.value || '';
    const qty = (document.getElementById('qtyInput') as HTMLInputElement)?.value || '1';

    if (isCustom) {
      const customVal = (document.getElementById('customInput') as HTMLInputElement)?.value || '';
      item = customVal.trim() !== '' ? customVal : (
        strLang === 'ko' ? '직접입력' :
          strLang === 'en' ? 'Direct Input' :
            strLang === 'ja' ? '直接入力' : '直接输入'
      );
    }

    if (!cat || (!item && !isCustom)) {
      toast('warning', t.alertCat);
      return;
    }

    setCart([...cart, { id: Date.now(), category: cat, itemName: item, specification: spec, quantity: qty }]);
  };

  const handleOrderSubmit = async () => {
    if (cart.length === 0) {
      toast('warning', t.noItems);
      return;
    }

    const name = (document.getElementById('order_name') as HTMLInputElement)?.value;
    const company = (document.getElementById('order_company') as HTMLInputElement)?.value;
    const phone = (document.getElementById('order_phone') as HTMLInputElement)?.value;
    const email = (document.getElementById('order_email') as HTMLInputElement)?.value;
    const cycle = (document.getElementById('regular_cycle') as HTMLInputElement)?.value;

    if (!name || !company || !phone || !email) {
      toast('warning', t.alertRequired);
      return;
    }

    const formData = new FormData();
    formData.append('action', 'send_bom_order');
    formData.append('lang', lang);
    formData.append('name', name);
    formData.append('company', company);
    formData.append('phone', phone);
    formData.append('email', email);
    formData.append('cart', JSON.stringify(cart));
    formData.append('is_regular', isRegular.toString());
    if (isRegular && cycle) formData.append('cycle', cycle);

    try {
      // reCAPTCHA v3
      const captchaToken = await new Promise<string>((resolve) => {
        (window as any).grecaptcha.ready(() => {
          (window as any).grecaptcha.execute(process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY!, { action: 'submit' }).then(resolve);
        });
      });
      formData.append('g-recaptcha-response', captchaToken);

      const res = await fetch('/api/send-mail', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.success) {
        toast('success', t.alertSuccess);
        setCart([]);
        (document.getElementById('order_name') as HTMLInputElement).value = '';
        (document.getElementById('order_company') as HTMLInputElement).value = '';
        (document.getElementById('order_phone') as HTMLInputElement).value = '';
        (document.getElementById('order_email') as HTMLInputElement).value = '';
      } else {
        toast('error', t.alertFailed + ": " + (data.error || "Unknown"));
      }
    } catch (err) {
      console.error(err);
      toast('error', t.alertError);
    }
  };

  return (
    <div id="Nexyfab-component-order">
      <section className="hat-hero hat-hero-bom">
        <div className="hat-hero-inner">
          <p className="hat-kicker">{t.heroKicker}</p>
          <h1 className="hat-hero-title">
            {isRegular ? t.heroTitleRegular : t.heroTitle} <span className="hat-hero-sub">{t.titleSub}</span>
          </h1>
          <p className="hat-hero-copy" dangerouslySetInnerHTML={{ __html: isRegular ? t.heroSubRegular : t.heroSub }} />
          <div className="hat-hero-meta">
            <span className="hat-pill">{t.badge1}</span>
            <span className="hat-pill">{t.badge2}</span>
            <span className="hat-pill">{t.badge3}</span>
          </div>
          <a href="#bom-start" className="hat-anchor">{t.anchor}</a>
        </div>
      </section>

      <main id="bom-start" className="hat-section" style={{ minHeight: '100vh' }}>
        <div className="hat-wrap-page reveal">
          <div className="hat-card reveal">
            <div className="hat-card-head">
              <div>{t.card1Title}</div>
            </div>
            <div className="hat-form-grid">
              <div className="hat-field">
                <label>{t.cat}</label>
                <select id="catSelect" value={selectedCat} onChange={handleCatChange}>
                  <option value="">{t.catPl}</option>
                  {Object.keys(BOM_DATA).map((category, idx) => (
                    <option key={idx} value={category}>{category}</option>
                  ))}
                </select>
              </div>
              <div className="hat-field">
                <label>{t.itemName}</label>
                <select id="itemSelect" value={selectedItem} onChange={handleItemChange} disabled={!selectedCat || selectedCat === customKey}>
                  <option value="">{t.itemPl}</option>
                  {currentItems.map((itemName, idx) => (
                    <option key={idx} value={itemName}>{itemName}</option>
                  ))}
                </select>
              </div>
              {isCustom && (
                <div className="hat-field hat-full" id="customWrap">
                  <label>{t.customInput}</label>
                  <input id="customInput" placeholder={t.customPl} type="text" />
                </div>
              )}
              <div className="hat-field">
                <label>{t.spec}</label>
                <input id="specInput" placeholder={t.specPl} type="text" />
              </div>
              <div className="hat-field">
                <label>{t.qty}</label>
                <input id="qtyInput" min="1" placeholder={t.qtyPl} type="number" defaultValue="1" />
              </div>
            </div>
            <div className="hat-actions">
              <button type="button" className="hat-btn-primary" onClick={handleAddToCart} style={{ backgroundColor: '#4f46e5', borderColor: '#4338ca', boxShadow: '0 8px 18px rgba(79, 70, 229, .20), 0 0 0 6px rgba(79, 70, 229, .12)' }}>{t.addBtn}</button>
            </div>
          </div>

          <div className="hat-card reveal">
            <div className="hat-card-head">
              <div>{t.card2Title}</div>
            </div>
            <div className="hat-table-wrap">
              <table id="bomTable">
                <thead>
                  <tr>
                    <th>{t.colNo}</th>
                    <th>{t.colCat}</th>
                    <th>{t.colName}</th>
                    <th>{t.colSpec}</th>
                    <th>{t.colQty}</th>
                    <th>{t.colDelete}</th>
                  </tr>
                </thead>
                <tbody>
                  {cart.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: '#888' }}>{t.noItems}</td></tr>
                  ) : (
                    cart.map((item, idx) => (
                      <tr key={item.id}>
                        <td>{idx + 1}</td>
                        <td>{item.category}</td>
                        <td>{item.itemName}</td>
                        <td>{item.specification || '-'}</td>
                        <td>{item.quantity}</td>
                        <td><button type="button" onClick={() => setCart(cart.filter(c => c.id !== item.id))} className="hat-btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }}>{t.deleteBtn}</button></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="hat-card reveal">
            <div className="hat-card-head">
              <div>{t.card3Title}</div>
            </div>
            <div className="hat-form-grid">
              <div className="hat-field">
                <label>{t.orderName}</label>
                <input id="order_name" type="text" />
              </div>
              <div className="hat-field">
                <label>{t.orderCompany}</label>
                <input id="order_company" type="text" />
              </div>
              <div className="hat-field">
                <label>{t.orderPhone}</label>
                <input id="order_phone" type="text" />
              </div>
              <div className="hat-field">
                <label>{t.orderEmail}</label>
                <input id="order_email" type="email" />
              </div>
              {isRegular && (
                <div className="hat-field hat-full">
                  <label>{t.regCycle}</label>
                  <input id="regular_cycle" type="text" placeholder={t.regCyclePl} />
                </div>
              )}
            </div>
            <div className="hat-actions hat-actions-split">
              <button className="hat-btn-secondary" onClick={() => {
                const header = `${t.colNo},${t.colCat},${t.colName},${t.colSpec},${t.colQty}\n`;
                const rows = cart.map((it, idx) => `${idx + 1},${it.category},${it.itemName},${it.specification},${it.quantity}`).join('\n');
                const blob = new Blob(["\uFEFF" + header + rows], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.setAttribute("href", url);
                link.setAttribute("download", "BOM_Cart.csv");
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}>{t.csvBtn}</button>
              <button className="hat-btn-green" onClick={handleOrderSubmit}>{t.submitBtn}</button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
