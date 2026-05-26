/* ══════════════════════════════════════════════
   비상장주식 가치평가 시스템 — valuation.js
   상증세법 보충적 평가방법 (시행령 §54~§56)
   ══════════════════════════════════════════════ */

'use strict';

/* ────────────────────────────────────────────
   1. 유틸리티
──────────────────────────────────────────── */
function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Math.round(n).toLocaleString('ko-KR');
}
function fmtW(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const abs = Math.abs(Math.round(n));
  return (n < 0 ? '−' : '') + abs.toLocaleString('ko-KR') + ' 원';
}
function parseNum(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const v = el.value.replace(/,/g, '').trim();
  if (v === '' || v === '-' || v === '−') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
function parseNumOr0(id) {
  const n = parseNum(id);
  return n === null ? 0 : n;
}
function calcStep(label, formula, result, cls) {
  return `<div class="calc-step ${cls||''}">
    <span class="calc-step-label">${label}</span>
    <span class="calc-step-formula">${formula}</span>
    <span class="calc-step-result">${fmtW(result)}</span>
  </div>`;
}
function calcStepRaw(label, formula, resultStr, cls) {
  return `<div class="calc-step ${cls||''}">
    <span class="calc-step-label">${label}</span>
    <span class="calc-step-formula">${formula}</span>
    <span class="calc-step-result">${resultStr}</span>
  </div>`;
}

/* ────────────────────────────────────────────
   2. 콤마 자동 포맷
──────────────────────────────────────────── */
function initMoneyInputs() {
  document.querySelectorAll('input.money').forEach(inp => {
    inp.addEventListener('input', function () {
      const isNeg = this.value.startsWith('-');
      const raw = this.value.replace(/[^0-9.]/g, '');
      const parts = raw.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      this.value = (isNeg ? '-' : '') + (raw.includes('.') ? parts.join('.') : parts[0]);
    });
  });
}

/* ────────────────────────────────────────────
   3. 연도 탭
──────────────────────────────────────────── */
function initTabs() {
  document.querySelectorAll('.year-tab').forEach(tab => {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.year-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.year-panel').forEach(p => p.classList.remove('active'));
      this.classList.add('active');
      document.getElementById('panel-' + this.dataset.tab).classList.add('active');
    });
  });
}

/* ────────────────────────────────────────────
   4. 최대주주 체크박스
──────────────────────────────────────────── */
function initCheckboxes() {
  document.getElementById('isMajorHolder').addEventListener('change', function () {
    document.getElementById('majorRateGroup').style.display = this.checked ? 'block' : 'none';
  });
}

/* ────────────────────────────────────────────
   5. 계산 과정 토글
──────────────────────────────────────────── */
function toggleProcess(el) {
  el.classList.toggle('open');
  el.nextElementSibling.classList.toggle('open');
}
window.toggleProcess = toggleProcess;

/* ────────────────────────────────────────────
   6. 유효성 검사
──────────────────────────────────────────── */
function validate() {
  const REQUIRED = [
    ['companyName',      '법인명'],
    ['baseDate',         '평가기준일'],
    ['totalShares',      '발행주식 총수'],
    ['ownedShares',      '보유 주식 수'],
    ['ebt0',             'T년도 법인세 차감 전 순이익'],
    ['tax0',             'T년도 법인세 납부세액'],
    ['ebt1',             'T-1년도 법인세 차감 전 순이익'],
    ['tax1',             'T-1년도 법인세 납부세액'],
    ['ebt2',             'T-2년도 법인세 차감 전 순이익'],
    ['tax2',             'T-2년도 법인세 납부세액'],
    ['totalAssets',      '자산총액 (재무상태표)'],
    ['totalLiabilities', '부채총액 (재무상태표)'],
  ];
  let ok = true;
  const missing = [];
  REQUIRED.forEach(([id, label]) => {
    const el = document.getElementById(id);
    const errEl = document.getElementById('err-' + id);
    const stripped = el ? el.value.replace(/,/g, '').trim() : '';
    if (stripped === '') {
      if (el) el.classList.add('error');
      if (errEl) errEl.classList.add('show');
      missing.push(label);
      ok = false;
    } else {
      if (el) el.classList.remove('error');
      if (errEl) errEl.classList.remove('show');
    }
  });
  if (!ok) alert('다음 필수 항목을 입력해주세요:\n\n• ' + missing.join('\n• '));
  return ok;
}

/* ────────────────────────────────────────────
   7. 핵심 계산 로직
──────────────────────────────────────────── */
function doCalc() {
  /* 기본 정보 */
  const companyName    = document.getElementById('companyName').value.trim();
  const baseDate       = document.getElementById('baseDate').value.trim();
  const totalSharesBase = parseNumOr0('totalShares');
  const ownedShares    = parseNumOr0('ownedShares');
  const bizType        = document.getElementById('bizType').value;

  /* ── ① 순손익가치 계산 (시행령 §56)
         순손익액 = (EBT − 법인세) − 비경상손익
                   + 가산: 기부금이월손금 + 환급금이자
                   − 차감: 벌금/가산세 + 징수유예공과금
  ────────────────────────────────────── */
  const profitData = [0, 1, 2].map(i => {
    const ebt       = parseNumOr0('ebt' + i);
    const tax       = parseNumOr0('tax' + i);
    const nonrec    = parseNumOr0('nonrec' + i);   // 비경상손익(+이면 가산, -이면 차감)
    const donation  = parseNumOr0('donation' + i); // 기부금 한도초과 이월손금 가산
    const refund    = parseNumOr0('refund' + i);   // 법인세 환급금이자 가산
    const penalty   = parseNumOr0('penalty' + i);  // 벌금/과태료/가산세 차감
    const taxDefer  = parseNumOr0('taxDefer' + i); // 징수유예 공과금 차감

    const sharesRaw = parseNum('shares' + i);
    const shares    = sharesRaw !== null ? sharesRaw : totalSharesBase;

    /* 순손익액 */
    const netIncome = (ebt - tax)
                    - nonrec          /* 비경상손익 제거 */
                    + donation        /* 가산: 기부금이월손금 */
                    + refund          /* 가산: 환급금이자 */
                    - penalty         /* 차감: 벌금·가산세 */
                    - taxDefer;       /* 차감: 징수유예공과금 */

    const perShare = shares > 0 ? netIncome / shares : 0;
    return { ebt, tax, nonrec, donation, refund, penalty, taxDefer, netIncome, shares, perShare };
  });

  const weightedPerShare =
    (profitData[0].perShare * 3 +
     profitData[1].perShare * 2 +
     profitData[2].perShare * 1) / 6;

  const RETURN_RATE = 0.10; // 환원율 10% (시행령 §56①)
  const perShareProfitValue = weightedPerShare / RETURN_RATE;

  /* ── ② 순자산가치 계산 (시행령 §55)
         조정순자산 = (장부자산총액
                      + 투자주식 세법평가 조정차액
                      + 영업권 세법평가액
                      − 개발비·무형자산 세법 제외액
                      − 대손충당금 추가 차감액)
                     − 자기주식
                     − (장부부채총액
                        + 퇴직급여추계액 추가분
                        + 우발부채·소송충당액)
  ────────────────────────────────────── */
  const totalAssets      = parseNumOr0('totalAssets');
  const totalLiabilities = parseNumOr0('totalLiabilities');
  const treasuryStock    = parseNumOr0('treasuryStock');

  /* 자산 조정 */
  const investAdj    = parseNumOr0('investAdj');    // 투자주식 재평가 차액 (세법가 − 장부가)
  const goodwillTax  = parseNumOr0('goodwillTax');  // 영업권 세법평가액 가산
  const intangibleEx = parseNumOr0('intangibleEx'); // 개발비·무형자산 제외액 (차감)
  const badDebtAdj   = parseNumOr0('badDebtAdj');   // 대손충당금 추가 차감

  /* 부채 조정 */
  const retireAdj    = parseNumOr0('retireAdj');    // 퇴직급여추계액 추가 (장부 충당부채 초과분)
  const contingent   = parseNumOr0('contingent');   // 우발부채·소송충당

  const adjAssets =
    totalAssets
    + investAdj        /* +: 세법 > 장부 / -: 세법 < 장부 */
    + goodwillTax      /* 가산 */
    - intangibleEx     /* 차감 */
    - badDebtAdj       /* 차감 */
    - treasuryStock;   /* 자기주식 제외 */

  const adjLiabilities =
    totalLiabilities
    + retireAdj
    + contingent;

  const netAssets = adjAssets - adjLiabilities;
  const perShareAssetValue = totalSharesBase > 0 ? netAssets / totalSharesBase : 0;

  /* ── ③ 가중평균 합산 (시행령 §54) ── */
  let wProfit, wAsset;
  if (bizType === 'property') { wProfit = 0.4; wAsset = 0.6; }
  else                        { wProfit = 0.6; wAsset = 0.4; }

  const blendedRaw = perShareProfitValue * wProfit + perShareAssetValue * wAsset;

  /* 하한: 순자산가치의 80% 미만 시 80% 적용 (시행령 §54②) */
  const floorValue  = perShareAssetValue * 0.80;
  let perShareBase  = blendedRaw;
  let floorApplied  = false;
  if (blendedRaw < floorValue) { perShareBase = floorValue; floorApplied = true; }

  /* ── ④ 최대주주 할증 (상증세법 §63③) ── */
  const isMajor = document.getElementById('isMajorHolder').checked;
  let surchargeRate = 0;
  if (isMajor) {
    const majorRate = parseNum('majorRate');
    surchargeRate = (majorRate !== null && majorRate > 50) ? 0.30 : 0.20;
  }
  const perShareFinal = perShareBase * (1 + surchargeRate);
  const totalValue    = perShareFinal * ownedShares;

  /* ── ⑤ 결과 UI 렌더링 ── */
  renderResult({
    companyName, baseDate, ownedShares, totalSharesBase,
    profitData, weightedPerShare, perShareProfitValue,
    totalAssets, totalLiabilities, treasuryStock,
    investAdj, goodwillTax, intangibleEx, badDebtAdj,
    retireAdj, contingent, adjAssets, adjLiabilities,
    netAssets, perShareAssetValue,
    wProfit, wAsset, blendedRaw, floorValue, floorApplied,
    isMajor, surchargeRate, perShareBase, perShareFinal, totalValue, bizType,
  });
}

/* ────────────────────────────────────────────
   8. 결과 렌더링
──────────────────────────────────────────── */
function renderResult(d) {
  const {
    companyName, baseDate, ownedShares, totalSharesBase,
    profitData, weightedPerShare, perShareProfitValue,
    totalAssets, totalLiabilities, treasuryStock,
    investAdj, goodwillTax, intangibleEx, badDebtAdj,
    retireAdj, contingent, adjAssets, adjLiabilities,
    netAssets, perShareAssetValue,
    wProfit, wAsset, blendedRaw, floorValue, floorApplied,
    isMajor, surchargeRate, perShareBase, perShareFinal, totalValue, bizType,
  } = d;

  /* 헤더 */
  document.getElementById('result-title').textContent = `비상장주식 가치평가 결과 — ${companyName}`;
  document.getElementById('result-company').textContent = `평가기준일: ${baseDate}`;
  document.getElementById('result-basedate-label').textContent = `평가기준일: ${baseDate || '—'}`;
  document.getElementById('res-perShare').textContent = fmtW(perShareFinal);
  document.getElementById('res-totalVal').textContent =
    `보유주식 ${fmt(ownedShares)}주 × ${fmtW(perShareFinal)} = ${fmtW(totalValue)}`;

  /* 요약표 */
  const tbody = document.getElementById('result-table-body');
  tbody.innerHTML = '';

  const addRow = (label, desc, val, cls) => {
    const tr = document.createElement('tr');
    tr.className = cls || '';
    tr.innerHTML = `<td><strong>${label}</strong></td><td>${desc}</td><td class="num">${val}</td>`;
    tbody.appendChild(tr);
  };
  const addSubRow = (desc) => {
    const tr = document.createElement('tr');
    tr.className = 'sub-row';
    tr.innerHTML = `<td></td><td class="formula-cell" colspan="2">${desc}</td>`;
    tbody.appendChild(tr);
  };

  addRow('순손익가치', '1주당 순손익가치 (시행령 §56)', fmtW(perShareProfitValue));
  addSubRow(`가중평균 1주당 순손익 ${fmtW(weightedPerShare)} ÷ 환원율 10%`);
  addRow('순자산가치', '1주당 순자산가치 (시행령 §55)', fmtW(perShareAssetValue));
  addSubRow(`조정순자산 ${fmtW(netAssets)} ÷ 발행주식 ${fmt(totalSharesBase)}주`);
  addRow('가중평균',
    bizType === 'property' ? '순손익 40% + 순자산 60%' : '순손익 60% + 순자산 40%',
    fmtW(blendedRaw));
  if (floorApplied) {
    addRow('⚠ 하한 적용', '순자산가치 80% 하한 적용 (시행령 §54②)', fmtW(floorValue));
  }
  if (isMajor) {
    addRow(`최대주주 할증 +${Math.round(surchargeRate * 100)}%`,
      `상증세법 §63③ (${surchargeRate === 0.30 ? '지분 50% 초과 → 30%' : '20%'})`,
      fmtW(perShareBase * surchargeRate));
  }
  /* 최종 */
  const trF = document.createElement('tr');
  trF.className = 'highlight-row';
  trF.innerHTML = `<td><strong>최종 1주당 평가액</strong></td>
    <td>${isMajor ? `할증(${Math.round(surchargeRate * 100)}%) 적용 후` : '기본 평가액'}</td>
    <td class="num">${fmtW(perShareFinal)}</td>`;
  tbody.appendChild(trF);

  /* ── 계산 과정: 순손익가치 ── */
  const yearLabels = ['T년도(최근, ×3)', 'T-1년도(×2)', 'T-2년도(×1)'];
  let ppHtml = '';
  profitData.forEach((p, i) => {
    const yr = (document.getElementById('year' + i).value || `T-${i}`);
    ppHtml += `<div class="calc-step"><span class="calc-step-label"><strong>${yr} ${yearLabels[i]}</strong></span><span class="calc-step-formula"></span><span class="calc-step-result"></span></div>`;
    ppHtml += calcStep('  EBT', '법인세 차감 전 순이익', p.ebt);
    ppHtml += calcStep('  − 법인세', '실제 납부세액', -p.tax, 'sub-step');
    if (p.nonrec !== 0) ppHtml += calcStep('  ± 비경상손익 제거', '일시적 손익 제거', -p.nonrec, p.nonrec > 0 ? 'sub-step' : 'add-step');
    if (p.donation !== 0) ppHtml += calcStep('  + 기부금이월손금', '가산 (시행령 §56②)', p.donation, 'add-step');
    if (p.refund !== 0)   ppHtml += calcStep('  + 환급금이자',     '법인세 환급금이자 가산', p.refund, 'add-step');
    if (p.penalty !== 0)  ppHtml += calcStep('  − 벌금·가산세',    '차감 (손금불산입 → 실유출)', -p.penalty, 'sub-step');
    if (p.taxDefer !== 0) ppHtml += calcStep('  − 징수유예공과금', '차감 (의무납부 아님)', -p.taxDefer, 'sub-step');
    ppHtml += calcStep(`  = 순손익액 ÷ ${fmt(p.shares)}주`, '1주당 순손익', p.perShare);
  });
  ppHtml += calcStepRaw('가중평균 1주당 순손익',
    `(${fmtW(profitData[0].perShare)}×3 + ${fmtW(profitData[1].perShare)}×2 + ${fmtW(profitData[2].perShare)}×1) ÷ 6`,
    fmtW(weightedPerShare));
  ppHtml += calcStepRaw('1주당 순손익가치', `${fmtW(weightedPerShare)} ÷ 10% (환원율)`, fmtW(perShareProfitValue));
  document.getElementById('process-profit').innerHTML = ppHtml;

  /* ── 계산 과정: 순자산가치 ── */
  let paHtml = '';
  paHtml += calcStep('자산총액 (장부)', '재무상태표 자산 합계', totalAssets);
  if (investAdj !== 0)    paHtml += calcStep('± 투자주식 재평가', '세법평가액 − 장부가액 (시행령 §55②)', investAdj, investAdj > 0 ? 'add-step' : 'sub-step');
  if (goodwillTax !== 0)  paHtml += calcStep('+ 영업권 세법평가', '영업권 강제 가산 (시행령 §59)', goodwillTax, 'add-step');
  if (intangibleEx !== 0) paHtml += calcStep('− 개발비·무형자산 제외', '세법상 가치 없음 → 0원 처리', -intangibleEx, 'sub-step');
  if (badDebtAdj !== 0)   paHtml += calcStep('− 대손충당금 추가', '실회수불능 채권 차감', -badDebtAdj, 'sub-step');
  if (treasuryStock !== 0) paHtml += calcStep('− 자기주식', '순자산 제외 (시행령 §55①)', -treasuryStock, 'sub-step');
  paHtml += calcStep('= 조정 자산총액', '자산 조정 후 합계', adjAssets);

  paHtml += '<hr style="border:none;border-top:1px dashed #e0dbd2;margin:10px 0">';
  paHtml += calcStep('부채총액 (장부)', '재무상태표 부채 합계', totalLiabilities);
  if (retireAdj !== 0)  paHtml += calcStep('+ 퇴직급여추계액 추가', '전액 기준 충당부채 초과분 (시행령 §55②)', retireAdj, 'sub-step');
  if (contingent !== 0) paHtml += calcStep('+ 우발부채·소송충당', '실현 확실한 우발부채', contingent, 'sub-step');
  paHtml += calcStep('= 조정 부채총액', '부채 조정 후 합계', adjLiabilities);

  paHtml += '<hr style="border:none;border-top:2px solid var(--navy);margin:12px 0">';
  paHtml += calcStep('조정 순자산', `${fmtW(adjAssets)} − ${fmtW(adjLiabilities)}`, netAssets);
  paHtml += calcStepRaw('1주당 순자산가치', `${fmtW(netAssets)} ÷ ${fmt(totalSharesBase)}주`, fmtW(perShareAssetValue));
  document.getElementById('process-asset').innerHTML = paHtml;

  /* ── 계산 과정: 최종 합산 ── */
  let pfHtml = '';
  pfHtml += calcStepRaw('순손익가치 반영', `${fmtW(perShareProfitValue)} × ${Math.round(wProfit * 100)}%`, fmtW(perShareProfitValue * wProfit));
  pfHtml += calcStepRaw('순자산가치 반영', `${fmtW(perShareAssetValue)} × ${Math.round(wAsset * 100)}%`, fmtW(perShareAssetValue * wAsset));
  pfHtml += calcStepRaw('가중평균 주식가치', `두 가치의 가중합산`, fmtW(blendedRaw));
  if (floorApplied) {
    pfHtml += `<div class="calc-step sub-step" style="background:#fff5f5;border-radius:6px;padding:10px 12px;">
      <span class="calc-step-label">⚠ 하한 적용</span>
      <span class="calc-step-formula">가중평균(${fmtW(blendedRaw)}) &lt; 순자산가치×80%(${fmtW(floorValue)}) → 하한 적용 (시행령 §54②)</span>
      <span class="calc-step-result">${fmtW(floorValue)}</span>
    </div>`;
  }
  if (isMajor) {
    pfHtml += calcStepRaw('최대주주 할증',
      `${fmtW(perShareBase)} × ${Math.round(surchargeRate * 100)}% (상증세법 §63③)`,
      `+ ${fmtW(perShareBase * surchargeRate)}`);
  }
  pfHtml += `<div class="calc-step" style="border-top:2px solid var(--navy);margin-top:10px;padding-top:14px;">
    <span class="calc-step-label"><strong>최종 1주당 평가액</strong></span>
    <span class="calc-step-formula"><strong>상기 합산 결과</strong></span>
    <span class="calc-step-result" style="color:var(--navy-deep);font-size:15px;"><strong>${fmtW(perShareFinal)}</strong></span>
  </div>`;
  pfHtml += calcStepRaw('보유주식 총 평가액', `${fmtW(perShareFinal)} × ${fmt(ownedShares)}주`, fmtW(totalValue));
  document.getElementById('process-final').innerHTML = pfHtml;

  /* 계산 패널 모두 열기 */
  document.querySelectorAll('.process-toggle').forEach(t => {
    t.classList.add('open');
    t.nextElementSibling.classList.add('open');
  });
}

/* ────────────────────────────────────────────
   9. 계산 진입점
──────────────────────────────────────────── */
function calculate() {
  if (!validate()) return;

  const btn = document.getElementById('calcBtn');
  btn.classList.add('calculating');
  btn.disabled = true;

  try {
    doCalc();
    const rs = document.getElementById('result-section');
    rs.style.display = 'block';
    rs.classList.add('show');
    setTimeout(() => rs.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  } catch (e) {
    alert('계산 중 오류가 발생했습니다: ' + e.message);
    console.error(e);
  } finally {
    btn.classList.remove('calculating');
    btn.disabled = false;
  }
}
window.calculate = calculate;

/* ────────────────────────────────────────────
   10. 샘플 데이터
──────────────────────────────────────────── */
function fillSample() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };

  /* 기본 정보 */
  set('companyName', 'J주식회사');
  set('baseDate',    '2024-12-31');
  set('totalShares', '100,000');
  set('ownedShares', '10,000');
  set('year0', '2024'); set('year1', '2023'); set('year2', '2022');

  /* 순손익 — T년도 */
  set('ebt0', '500,000,000'); set('tax0', '100,000,000');
  set('nonrec0', '20,000,000');   /* 비경상 이익 2천만 (차감) */
  set('donation0', '0'); set('refund0', '5,000,000');
  set('penalty0', '3,000,000'); set('taxDefer0', '0');

  /* 순손익 — T-1년도 */
  set('ebt1', '400,000,000'); set('tax1', '80,000,000');
  set('nonrec1', '0');
  set('donation1', '10,000,000'); set('refund1', '0');
  set('penalty1', '2,000,000'); set('taxDefer1', '0');

  /* 순손익 — T-2년도 */
  set('ebt2', '300,000,000'); set('tax2', '60,000,000');
  set('nonrec2', '-15,000,000'); /* 비경상 손실 1.5천만 (가산) */
  set('donation2', '0'); set('refund2', '0');
  set('penalty2', '0'); set('taxDefer2', '1,000,000');

  /* 순자산 — 자산 */
  set('totalAssets', '5,000,000,000');
  set('investAdj',    '-50,000,000');  /* 투자주식 세법평가 하락 */
  set('goodwillTax',  '80,000,000');   /* 영업권 세법평가 가산 */
  set('intangibleEx', '30,000,000');   /* 개발비 제외 */
  set('badDebtAdj',   '20,000,000');   /* 대손 추가 */

  /* 순자산 — 부채 */
  set('totalLiabilities', '2,000,000,000');
  set('treasuryStock',     '0');
  set('retireAdj',  '50,000,000');  /* 퇴직급여 추가충당 */
  set('contingent', '30,000,000'); /* 우발부채 */

  alert('샘플 데이터가 입력되었습니다.\n\n· T년도 비경상이익 2천만(제거), 환급금이자 500만, 벌금 300만\n· T-1년도 기부금이월손금 1천만\n· T-2년도 비경상손실 1.5천만(가산), 징수유예 100만\n· 투자주식 재평가 -5천만, 영업권 +8천만, 개발비 제외 3천만\n· 퇴직급여 추가 5천만, 우발부채 3천만\n\n[가치평가 계산하기]를 클릭하여 결과를 확인하세요.');
}
window.fillSample = fillSample;

/* ────────────────────────────────────────────
   11. 초기화
──────────────────────────────────────────── */
function resetAll() {
  if (!confirm('입력한 모든 데이터를 초기화하겠습니까?')) return;
  document.querySelectorAll('input[type="text"]').forEach(el => el.value = '');
  document.querySelectorAll('input[type="checkbox"]').forEach(el => el.checked = false);
  document.querySelectorAll('select').forEach(el => el.selectedIndex = 0);
  document.getElementById('majorRateGroup').style.display = 'none';

  const rs = document.getElementById('result-section');
  rs.style.display = 'none';
  rs.classList.remove('show');

  document.querySelectorAll('.error-msg').forEach(el => el.classList.remove('show'));
  document.querySelectorAll('input.error').forEach(el => el.classList.remove('error'));

  document.querySelectorAll('.year-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
  document.querySelectorAll('.year-panel').forEach((p, i) => p.classList.toggle('active', i === 0));

  /* 날짜 재설정 */
  setTodayDate();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.resetAll = resetAll;

/* ────────────────────────────────────────────
   12. 초기화 (DOMContentLoaded)
──────────────────────────────────────────── */
function setTodayDate() {
  const t = new Date();
  const yyyy = t.getFullYear();
  const mm = String(t.getMonth() + 1).padStart(2, '0');
  const dd = String(t.getDate()).padStart(2, '0');
  const el = document.getElementById('baseDate');
  if (el) el.value = `${yyyy}-${mm}-${dd}`;
}

document.addEventListener('DOMContentLoaded', () => {
  initMoneyInputs();
  initTabs();
  initCheckboxes();
  setTodayDate();
});
