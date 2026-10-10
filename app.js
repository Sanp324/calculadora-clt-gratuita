'use strict';

const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (value) => currency.format(Math.round((value + Number.EPSILON) * 100) / 100);

// Official 2026 schedules: INSS Portaria Interministerial MPS/MF 13/2026
// and Receita Federal monthly IRPF table. Benefit bands are the 2026 MTE schedule.
const TAX_2026 = {
  inss: [
    { limit: 1621, rate: 0.075 },
    { limit: 2902.84, rate: 0.09 },
    { limit: 4354.27, rate: 0.12 },
    { limit: 8475.55, rate: 0.14 }
  ],
  irrf: [
    { limit: 2428.8, rate: 0, deduction: 0 },
    { limit: 2826.65, rate: 0.075, deduction: 182.16 },
    { limit: 3751.05, rate: 0.15, deduction: 394.16 },
    { limit: 4664.68, rate: 0.225, deduction: 675.49 },
    { limit: Infinity, rate: 0.275, deduction: 908.73 }
  ],
  dependentDeduction: 189.59,
  simplifiedDeduction: 607.2,
  minBenefit: 1621,
  benefitFirstBandLimit: 2222.17,
  benefitSecondBandBase: 1777.74,
  benefitSecondBandLimit: 3703.99,
  benefitMax: 2518.65
};

function activateTab(tab, moveFocus = false) {
  tabs.forEach((item) => {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
  });
  panels.forEach((panel) => panel.classList.toggle('hidden', panel.id !== tab.getAttribute('aria-controls')));
  if (moveFocus) tab.focus();
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', (event) => {
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    activateTab(tabs[nextIndex], true);
  });
});

function readDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function addMonthsClamped(date, months) {
  const firstOfTarget = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth() + 1, 0).getDate();
  return new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth(), Math.min(date.getDate(), lastDay));
}

function countCalendarDaysInclusive(start, end) {
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return endDay < startDay ? 0 : (endDay - startDay) / (24 * 60 * 60 * 1000) + 1;
}

function countFullYears(start, end) {
  let years = 0;
  while (years < 100 && addMonthsClamped(start, (years + 1) * 12) <= end) years += 1;
  return years;
}

function countMonthsWithAtLeast15Days(start, end, months = 12) {
  let count = 0;
  for (let index = 0; index < months; index += 1) {
    const periodStart = addMonthsClamped(start, index);
    const periodEnd = addDays(addMonthsClamped(start, index + 1), -1);
    const activeStart = periodStart > start ? periodStart : start;
    const activeEnd = periodEnd < end ? periodEnd : end;
    const activeDays = countCalendarDaysInclusive(activeStart, activeEnd);
    if (activeDays >= 15) count += 1;
  }
  return count;
}

function countCalendarMonthsWithAtLeast15Days(start, end) {
  let count = 0;
  for (let month = 0; month < 12; month += 1) {
    const monthStart = new Date(end.getFullYear(), month, 1);
    const monthEnd = new Date(end.getFullYear(), month + 1, 0);
    const activeStart = monthStart > start ? monthStart : start;
    const activeEnd = monthEnd < end ? monthEnd : end;
    const activeDays = countCalendarDaysInclusive(activeStart, activeEnd);
    if (activeDays >= 15) count += 1;
  }
  return count;
}

function progressiveContribution(base, brackets) {
  const toCents = (value) => {
    const [coefficient, exponentText] = String(value).toLowerCase().split('e');
    const exponent = Number(exponentText || 0);
    const negative = coefficient.startsWith('-');
    const unsigned = negative ? coefficient.slice(1) : coefficient;
    const [whole, fraction = ''] = unsigned.split('.');
    let cents = BigInt(`${whole}${fraction}`);
    const shift = 2 - (fraction.length - exponent);
    if (shift >= 0) {
      cents *= 10n ** BigInt(shift);
    } else {
      const divisor = 10n ** BigInt(-shift);
      cents = (cents + divisor / 2n) / divisor;
    }
    return negative ? -cents : cents;
  };

  const baseCents = toCents(base);
  let previousLimitCents = 0n;
  let amountInFractionalCents = 0n;
  for (const bracket of brackets) {
    const limitCents = toCents(bracket.limit);
    const taxableCents = baseCents < limitCents ? baseCents : limitCents;
    const bandCents = taxableCents > previousLimitCents ? taxableCents - previousLimitCents : 0n;
    const rateBasisPoints = BigInt(Math.round(bracket.rate * 10000));
    amountInFractionalCents += bandCents * rateBasisPoints;
    previousLimitCents = limitCents;
    if (baseCents <= limitCents) break;
  }
  const totalCents = (amountInFractionalCents + 5000n) / 10000n;
  return Number(totalCents) / 100;
}

function calculateInss(base) {
  return progressiveContribution(Math.min(Math.max(0, base), 8475.55), TAX_2026.inss);
}

function calculateIrrf(grossIncome, inss, dependents, isThirteenth = false) {
  const grossCents = Math.max(0, Math.round(grossIncome * 100));
  const inssCents = Math.max(0, Math.round(inss * 100));
  const dependentDeductionCents = Math.round(TAX_2026.dependentDeduction * 100) * dependents;
  const legalDeductionCents = inssCents + dependentDeductionCents;
  const simplifiedDeductionCents = Math.round(TAX_2026.simplifiedDeduction * 100);
  const deductionCents = Math.max(legalDeductionCents, simplifiedDeductionCents);
  const taxableBaseCents = Math.max(0, grossCents - deductionCents);
  const bracket = TAX_2026.irrf.find((item) => taxableBaseCents <= Math.round(item.limit * 100));
  const taxCents = Math.max(
    0,
    Math.round(taxableBaseCents * bracket.rate) - Math.round(bracket.deduction * 100)
  );

  if (!isThirteenth && grossCents <= 500000) return 0;
  if (!isThirteenth && grossCents <= 735000) {
    const reductionCents = Math.round(978.62 * 100 - 0.133145 * grossCents);
    return Math.max(0, taxCents - reductionCents) / 100;
  }
  return taxCents / 100;
}

function showError(element, message) {
  element.textContent = message;
  element.classList.remove('hidden');
}

function renderTableResult(element, title, rows, note, extra = '') {
  const body = rows.map(([label, value, kind]) => `
    <tr class="${kind === 'total' ? 'border-t-2 border-emerald-200 font-extrabold text-emerald-950' : 'border-t border-emerald-100 text-slate-700'}">
      <th scope="row" class="py-2.5 pr-4 text-left font-${kind === 'total' ? 'extrabold' : 'medium'}">${label}</th>
      <td class="py-2.5 text-right ${kind === 'discount' ? 'text-rose-700' : ''}">${kind === 'discount' ? '− ' : ''}${money(Math.abs(value))}</td>
    </tr>`).join('');
  element.innerHTML = `
    <h4 class="text-sm font-extrabold text-emerald-950">${title}</h4>
    <div class="mt-3 overflow-x-auto">
      <table class="w-full border-collapse text-sm">
        <thead><tr class="text-xs uppercase tracking-wide text-slate-500"><th class="pb-2 text-left">Descrição</th><th class="pb-2 text-right">Valor estimado</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    ${extra}
    <p class="mt-3 text-xs leading-5 text-slate-500">${note}</p>`;
  element.classList.remove('hidden');
}

function clearResult(element) {
  element.classList.add('hidden');
  element.replaceChildren();
}

[
  ['rescisao-form', 'rescisao-result'],
  ['ferias-form', 'ferias-result'],
  ['seguro-form', 'seguro-result'],
  ['salario-liquido-form', 'salario-liquido-result']
].forEach(([formId, resultId]) => {
  document.getElementById(formId).addEventListener('invalid', () => {
    clearResult(document.getElementById(resultId));
  }, true);
});

const rescisaoForm = document.getElementById('rescisao-form');
const rescisaoResult = document.getElementById('rescisao-result');

rescisaoForm.addEventListener('submit', (event) => {
  event.preventDefault();
  clearResult(rescisaoResult);
  const data = new FormData(rescisaoForm);
  const salary = Number(data.get('salario'));
  const admission = readDate(String(data.get('admissao')));
  const termination = readDate(String(data.get('desligamento')));
  const dependents = Number(data.get('dependentes'));
  const unpaidPeriods = Number(data.get('ferias-vencidas'));
  const overduePeriods = Number(data.get('ferias-em-dobro'));
  const fgtsBalance = Number(data.get('fgts')) || 0;
  const reason = String(data.get('motivo'));
  const notice = String(data.get('aviso'));

  if (!Number.isFinite(salary) || !(salary > 0) || !admission || !termination || termination < admission ||
      !Number.isInteger(dependents) || dependents < 0 || dependents > 50 ||
      !Number.isInteger(unpaidPeriods) || unpaidPeriods < 0 || unpaidPeriods > 20 ||
      !Number.isInteger(overduePeriods) || overduePeriods < 0 || overduePeriods > unpaidPeriods ||
      !Number.isFinite(fgtsBalance) || fgtsBalance < 0) {
    showError(rescisaoResult, 'Confira salário, datas, dependentes, saldo de FGTS e períodos de férias. As férias vencidas em dobro não podem superar o total de períodos não gozados.');
    return;
  }

  const dailySalary = salary / 30;
  const lastDayOfMonth = new Date(termination.getFullYear(), termination.getMonth() + 1, 0).getDate();
  const salaryBalance = termination.getDate() === lastDayOfMonth
    ? salary
    : dailySalary * termination.getDate();
  const employerTermination = reason === 'sem-justa-causa' || reason === 'acordo';
  const employerIndemnifiesNotice = employerTermination && notice === 'indenizado';
  const yearsWorked = countFullYears(admission, termination);
  const noticeDays = Math.min(90, 30 + Math.max(0, yearsWorked) * 3);
  const noticePay = employerIndemnifiesNotice
    ? dailySalary * noticeDays * (reason === 'acordo' ? 0.5 : 1)
    : 0;
  const noticeDeduction = reason === 'pedido' && notice === 'nao-cumprido' ? Math.min(salary, dailySalary * 30) : 0;
  const workedNoticeAlreadyIncluded = reason === 'sem-justa-causa' && notice === 'trabalhado';
  const projectionDays = reason === 'acordo' && notice === 'indenizado'
    ? Math.floor(noticeDays / 2)
    : noticeDays;
  const effectiveEnd = workedNoticeAlreadyIncluded
    ? termination
    : employerIndemnifiesNotice ? addDays(termination, projectionDays) : termination;
  const proportionalEligible = reason !== 'justa-causa';
  const currentYearStart = new Date(effectiveEnd.getFullYear(), 0, 1);
  const currentYearEnd = new Date(effectiveEnd.getFullYear(), 11, 31);
  const thirteenthMonths = proportionalEligible
    ? countCalendarMonthsWithAtLeast15Days(admission > currentYearStart ? admission : currentYearStart, effectiveEnd < currentYearEnd ? effectiveEnd : currentYearEnd)
    : 0;
  const thirteenth = salary * thirteenthMonths / 12;
  const completedVacationYears = countFullYears(admission, effectiveEnd);
  if (unpaidPeriods > completedVacationYears) {
    showError(rescisaoResult, `Pelos dados informados, há no máximo ${completedVacationYears} período(s) completo(s) de férias adquirido(s). Confira o número de períodos ainda não gozados.`);
    return;
  }
  const vacationPeriodStart = addMonthsClamped(admission, completedVacationYears * 12);
  const proportionalVacationMonths = proportionalEligible
    ? countMonthsWithAtLeast15Days(vacationPeriodStart, effectiveEnd)
    : 0;
  const proportionalVacation = salary * proportionalVacationMonths / 12 * (4 / 3);
  const regularVacation = salary * (unpaidPeriods - overduePeriods) * (4 / 3);
  const doubleVacation = salary * overduePeriods * (8 / 3);
  const fgtsFine = reason === 'sem-justa-causa' ? fgtsBalance * 0.4 : reason === 'acordo' ? fgtsBalance * 0.2 : 0;

  const inssSalary = calculateInss(salaryBalance);
  const inssThirteenth = calculateInss(thirteenth);
  const irrfSalary = calculateIrrf(salaryBalance, inssSalary, dependents);
  const irrfThirteenth = calculateIrrf(thirteenth, inssThirteenth, dependents, true);
  const toDisplayedCents = (value) => Math.round((value + Number.EPSILON) * 100);
  const grossCents = [
    salaryBalance,
    noticePay,
    thirteenth,
    regularVacation,
    doubleVacation,
    proportionalVacation
  ].reduce((total, value) => total + toDisplayedCents(value), 0);
  const deductionsCents = [
    inssSalary,
    inssThirteenth,
    irrfSalary,
    irrfThirteenth,
    noticeDeduction
  ].reduce((total, value) => total + toDisplayedCents(value), 0);
  const grossSeverance = grossCents / 100;
  const netSeverance = Math.max(0, grossCents - deductionsCents) / 100;
  const rows = [
    ['Saldo de salário', salaryBalance, 'earning'],
    ['Aviso-prévio indenizado estimado', noticePay, 'earning'],
    ['13º salário proporcional', thirteenth, 'earning'],
    ['Férias adquiridas e não gozadas + 1/3', regularVacation, 'earning'],
    ['Férias vencidas em dobro + 1/3 (períodos informados)', doubleVacation, 'earning'],
    ['Férias proporcionais + 1/3', proportionalVacation, 'earning'],
    ['Subtotal de proventos estimados', grossSeverance, 'total'],
    ['INSS sobre saldo de salário', inssSalary, 'discount'],
    ['INSS sobre 13º proporcional', inssThirteenth, 'discount'],
    ['IRRF estimado sobre saldo de salário', irrfSalary, 'discount'],
    ['IRRF estimado sobre 13º proporcional', irrfThirteenth, 'discount'],
    ['Aviso-prévio não cumprido (desconto estimado)', noticeDeduction, 'discount'],
    ['Total de descontos estimados', deductionsCents / 100, 'discount'],
    ['Total líquido estimado a receber (TRCT)', netSeverance, 'total']
  ];
  const extra = `<p class="mt-3 rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm text-slate-700"><strong>Valor de referência do FGTS:</strong> ${money(fgtsBalance)}</p><p class="mt-2 rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm text-slate-700"><strong>Multa estimada do FGTS (${reason === 'acordo' ? '20%' : reason === 'sem-justa-causa' ? '40%' : 'não aplicável'}):</strong> ${money(fgtsFine)} <span class="mt-1 block text-xs text-slate-500">Calculada sobre o valor de referência informado; não compõe o líquido do TRCT.</span></p>`;
  renderTableResult(
    rescisaoResult,
    'Estimativa detalhada da rescisão',
    rows,
    'Estimativa simplificada com tabelas de INSS e IRRF de 2026. Pisos categoriais e adicionais previstos em convenção coletiva (CCT) podem alterar os valores finais; confira a norma aplicável à sua categoria. Férias indenizadas e multa do FGTS são exibidas sem inclusão na base tributável estimada; médias variáveis, comissões e outros descontos também não estão incluídos. A projeção do aviso considera a data informada e precisa ser conferida pelo RH ou profissional especializado.',
    extra
  );
});

const feriasForm = document.getElementById('ferias-form');
const vacationDaysInput = feriasForm.elements.namedItem('dias');
const absenceInput = feriasForm.elements.namedItem('faltas');
const bonusInput = feriasForm.elements.namedItem('abono');

function vacationEntitlement(absences) {
  if (absences <= 5) return 30;
  if (absences <= 14) return 24;
  if (absences <= 23) return 18;
  if (absences <= 32) return 12;
  return 0;
}

function adjustVacationDays() {
  const absences = Number(absenceInput.value);
  if (!Number.isInteger(absences) || absences < 0) return;
  const entitlement = vacationEntitlement(absences);
  const maximumSold = bonusInput.checked ? Math.floor(entitlement / 3) : 0;
  const maximumRest = entitlement - maximumSold;
  if (Number(vacationDaysInput.value) > maximumRest && maximumRest >= 10) {
    vacationDaysInput.value = String(maximumRest);
  }
}

absenceInput.addEventListener('input', adjustVacationDays);
bonusInput.addEventListener('change', adjustVacationDays);

feriasForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const result = document.getElementById('ferias-result');
  clearResult(result);
  const data = new FormData(feriasForm);
  const salary = Number(data.get('salario'));
  const days = Number(data.get('dias'));
  const absences = Number(data.get('faltas'));
  const sellsDays = data.has('abono');
  if (!Number.isFinite(salary) || !(salary > 0) || !Number.isInteger(days) || days < 10 || days > 30 ||
      !Number.isInteger(absences) || absences < 0 || absences > 100) {
    showError(result, 'Informe salário válido, de 10 a 30 dias de férias e um número inteiro de faltas não justificadas.');
    return;
  }
  const entitlement = vacationEntitlement(absences);
  const soldDays = sellsDays ? Math.floor(entitlement / 3) : 0;
  if (entitlement === 0 || days + soldDays > entitlement) {
    showError(result, `Com ${absences} falta(s) não justificada(s), a regra geral indica ${entitlement} dia(s) de férias. Ajuste os dias de descanso e/ou desmarque o abono.`);
    return;
  }

  const salaryCents = Math.round(salary * 100);
  const vacationPayCents = Math.round(salaryCents * days / 30);
  const vacationThirdCents = Math.round(vacationPayCents / 3);
  const bonusPayCents = Math.round(salaryCents * soldDays / 30);
  const bonusThirdCents = Math.round(bonusPayCents / 3);
  const grossCents = vacationPayCents + vacationThirdCents + bonusPayCents + bonusThirdCents;
  const vacationPay = vacationPayCents / 100;
  const vacationThird = vacationThirdCents / 100;
  const bonusPay = bonusPayCents / 100;
  const bonusThird = bonusThirdCents / 100;
  const gross = grossCents / 100;
  const taxableVacation = vacationPay + vacationThird;
  const inss = calculateInss(taxableVacation);
  const irrf = calculateIrrf(taxableVacation, inss, 0);
  const netCents = Math.max(0, grossCents - Math.round(inss * 100) - Math.round(irrf * 100));
  const net = netCents / 100;
  renderTableResult(result, 'Estimativa de férias', [
    ['Remuneração dos dias de descanso', vacationPay, 'earning'],
    ['Adicional constitucional de 1/3', vacationThird, 'earning'],
    [`Abono pecuniário (${soldDays} dia(s))`, bonusPay, 'earning'],
    ['Terço constitucional correspondente ao abono', bonusThird, 'earning'],
    ['Total bruto estimado', gross, 'total'],
    ['INSS estimado sobre férias', inss, 'discount'],
    ['IRRF estimado sobre férias', irrf, 'discount'],
    ['Total líquido estimado', net, 'total']
  ], `Estimativa de ${entitlement} dia(s) de direito segundo a regra geral de faltas injustificadas. O abono é limitado a 1/3 do período. Tributos estimados com referências de 2026; não foram consideradas médias variáveis, outros rendimentos no mês nem descontos particulares.`);
});

const insuranceForm = document.getElementById('seguro-form');
insuranceForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const result = document.getElementById('seguro-result');
  clearResult(result);
  const data = new FormData(insuranceForm);
  const reason = String(data.get('motivo'));
  const request = Number(data.get('solicitacao'));
  const averageSalary = Number(data.get('media'));
  const averageSalaryCents = converterParaCentavosSalarioLiquido(averageSalary);
  const monthsInGracePeriod = Number(data.get('meses-carencia'));
  const monthsIn36 = Number(data.get('meses-36'));
  if (!Number.isFinite(averageSalary) || !(averageSalary > 0) || !Number.isSafeInteger(averageSalaryCents) || !Number.isInteger(monthsInGracePeriod) || monthsInGracePeriod < 0 || monthsInGracePeriod > 18 ||
      !Number.isInteger(monthsIn36) || monthsIn36 < 0 || monthsIn36 > 36) {
    showError(result, 'Informe uma média salarial válida e números inteiros de meses dentro dos períodos indicados.');
    return;
  }
  if (monthsInGracePeriod > monthsIn36) {
    showError(result, 'Os meses de carência informados não podem ser maiores que os meses trabalhados nos últimos 36 meses.');
    return;
  }

  const requiredMonths = request === 1 ? 12 : request === 2 ? 9 : 6;
  const meetsDismissalRule = reason === 'sem-justa-causa';
  const meetsGracePeriod = monthsInGracePeriod >= requiredMonths;
  const eligibleForEstimate = meetsDismissalRule && meetsGracePeriod;
  let installments = 0;
  if (eligibleForEstimate) {
    if (monthsIn36 >= 24) installments = 5;
    else if (monthsIn36 >= 12) installments = 4;
    else if (monthsIn36 >= requiredMonths) installments = 3;
  }
  const averageCents = BigInt(averageSalaryCents);
  const minBenefitCents = BigInt(Math.round(TAX_2026.minBenefit * 100));
  const firstBandLimitCents = BigInt(Math.round(TAX_2026.benefitFirstBandLimit * 100));
  const secondBandBaseCents = BigInt(Math.round(TAX_2026.benefitSecondBandBase * 100));
  const secondBandLimitCents = BigInt(Math.round(TAX_2026.benefitSecondBandLimit * 100));
  const benefitMaxCents = BigInt(Math.round(TAX_2026.benefitMax * 100));
  let installmentValueCents = (averageCents * 80n + 50n) / 100n;
  if (installmentValueCents < minBenefitCents) installmentValueCents = minBenefitCents;
  if (averageCents > firstBandLimitCents && averageCents <= secondBandLimitCents) {
    installmentValueCents = secondBandBaseCents +
      (averageCents - firstBandLimitCents + 1n) / 2n;
  } else if (averageCents > secondBandLimitCents) {
    installmentValueCents = benefitMaxCents;
  }
  if (installmentValueCents > benefitMaxCents) installmentValueCents = benefitMaxCents;
  const installmentValue = Number(installmentValueCents) / 100;
  const estimateMessage = eligibleForEstimate && installments > 0
    ? `<p class="mt-2 text-sm leading-6 text-emerald-900"><strong>Estimativa indicativa:</strong> ${installments} parcela(s) de ${money(installmentValue)}.</p>`
    : '<p class="mt-2 text-sm leading-6 text-amber-900"><strong>Os dados informados não atendem a todos os critérios gerais</strong> para uma estimativa de parcelas. Confira os requisitos e o histórico nos canais oficiais.</p>';
  const periodMessage = `Para a solicitação ${request === 1 ? '1ª' : request === 2 ? '2ª' : '3ª ou posterior'}, o período mínimo geral é de ${requiredMonths} mês(es) com salário.`;
  result.innerHTML = `
    <h4 class="text-sm font-extrabold text-slate-900">Consulta indicativa do seguro-desemprego</h4>
    ${estimateMessage}
    ${eligibleForEstimate && installments > 0 ? `<p class="mt-1 text-sm text-slate-700">Total estimado das parcelas: <strong>${money(Number(installmentValueCents * BigInt(installments)) / 100)}</strong>.</p>` : ''}
    <p class="mt-3 text-xs leading-5 text-slate-500">${periodMessage} O número de parcelas também depende dos meses trabalhados nos últimos 36 meses. A concessão ainda exige, entre outros requisitos, dispensa involuntária sem justa causa, ausência de renda própria suficiente e não recebimento de benefício previdenciário incompatível. Tabela estimada para 2026; a decisão e o valor oficial são do Ministério do Trabalho e Emprego. <a class="font-semibold text-emerald-800 underline" href="https://www.gov.br/pt-br/servicos/solicitar-o-seguro-desemprego" target="_blank" rel="noopener noreferrer">Consulte o canal oficial.</a></p>`;
  result.classList.remove('hidden');
});

const SALARIO_LIQUIDO_TABELAS = {
  2026: {
    inss: [
      { limitCents: 162100, rateBasisPoints: 750 },
      { limitCents: 290284, rateBasisPoints: 900 },
      { limitCents: 435427, rateBasisPoints: 1200 },
      { limitCents: 847555, rateBasisPoints: 1400 }
    ],
    inssCeilingCents: 847555,
    irrf: [
      { limitCents: 242880, rateBasisPoints: 0, deductionCents: 0 },
      { limitCents: 282665, rateBasisPoints: 750, deductionCents: 18216 },
      { limitCents: 375105, rateBasisPoints: 1500, deductionCents: 39416 },
      { limitCents: 466468, rateBasisPoints: 2250, deductionCents: 67549 },
      { limitCents: null, rateBasisPoints: 2750, deductionCents: 90873 }
    ],
    dependentDeductionCents: 18959,
    simplifiedDeductionCents: 60720,
    fullReductionLimitCents: 500000,
    partialReductionLimitCents: 735000,
    fullReductionCents: 31289,
    partialReductionBaseCents: 97862,
    partialReductionRateMillionths: 133145
  }
};

function arredondarDivisaoPositiva(numerator, denominator) {
  return (numerator + denominator / 2n) / denominator;
}

function converterParaCentavosSalarioLiquido(value) {
  return Math.round((value + Number.EPSILON) * 100);
}

function calcularInssSalarioLiquido(salaryCents, taxTable) {
  const contributionBase = BigInt(Math.min(salaryCents, taxTable.inssCeilingCents));
  let previousLimit = 0n;
  let contributionInFractionalCents = 0n;

  for (const bracket of taxTable.inss) {
    const limit = BigInt(bracket.limitCents);
    const taxableCents = contributionBase < limit ? contributionBase : limit;
    const bandCents = taxableCents > previousLimit ? taxableCents - previousLimit : 0n;
    contributionInFractionalCents += bandCents * BigInt(bracket.rateBasisPoints);
    previousLimit = limit;
    if (contributionBase <= limit) break;
  }

  return Number(arredondarDivisaoPositiva(contributionInFractionalCents, 10000n));
}

function calcularIrrfSalarioLiquido(salaryCents, inssCents, dependents, taxTable) {
  const legalDeduction = inssCents + taxTable.dependentDeductionCents * dependents;
  const usesLegalDeduction = legalDeduction > taxTable.simplifiedDeductionCents;
  const appliedDeduction = usesLegalDeduction ? legalDeduction : taxTable.simplifiedDeductionCents;
  const taxableBase = Math.max(0, salaryCents - appliedDeduction);
  const bracket = taxTable.irrf.find((item) => item.limitCents === null || taxableBase <= item.limitCents);
  const taxByTable = Math.max(
    0,
    Number(arredondarDivisaoPositiva(
      BigInt(taxableBase) * BigInt(bracket.rateBasisPoints),
      10000n
    )) - bracket.deductionCents
  );
  let taxReduction = 0;

  if (salaryCents <= taxTable.fullReductionLimitCents) {
    taxReduction = Math.min(taxByTable, taxTable.fullReductionCents);
  } else if (salaryCents <= taxTable.partialReductionLimitCents) {
    const reductionNumerator = BigInt(taxTable.partialReductionBaseCents) * 1000000n -
      BigInt(salaryCents) * BigInt(taxTable.partialReductionRateMillionths);
    const reductionByIncome = Math.max(
      0,
      Number(arredondarDivisaoPositiva(reductionNumerator, 1000000n))
    );
    taxReduction = Math.min(taxByTable, reductionByIncome);
  }

  return {
    taxableBaseCents: taxableBase,
    appliedDeductionCents: appliedDeduction,
    deductionMethod: usesLegalDeduction ? 'deduções legais' : 'desconto simplificado',
    taxCents: Math.max(0, taxByTable - taxReduction)
  };
}

const salarioLiquidoForm = document.getElementById('salario-liquido-form');
salarioLiquidoForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const result = document.getElementById('salario-liquido-result');
  clearResult(result);
  const data = new FormData(salarioLiquidoForm);
  const grossRaw = String(data.get('salario-bruto') ?? '').trim();
  const dependentsRaw = String(data.get('dependentes') ?? '').trim();
  const otherDeductionsRaw = String(data.get('outros-descontos') ?? '').trim();
  const salary = Number(grossRaw);
  const dependents = dependentsRaw === '' ? 0 : Number(dependentsRaw);
  const otherDeductions = otherDeductionsRaw === '' ? 0 : Number(otherDeductionsRaw);
  const referenceYear = Number(data.get('ano'));
  const taxTable = SALARIO_LIQUIDO_TABELAS[referenceYear];

  if (grossRaw === '' || !Number.isFinite(salary) || salary < 0 ||
      !Number.isSafeInteger(converterParaCentavosSalarioLiquido(salary)) ||
      !Number.isSafeInteger(dependents) || dependents < 0 ||
      !Number.isFinite(otherDeductions) || otherDeductions < 0 ||
      !Number.isSafeInteger(converterParaCentavosSalarioLiquido(otherDeductions)) ||
      !taxTable) {
    showError(result, 'Informe salário bruto, dependentes e outros descontos com valores válidos e não negativos. Selecione um ano de referência disponível.');
    return;
  }

  const grossCents = converterParaCentavosSalarioLiquido(salary);
  const otherDeductionsCents = converterParaCentavosSalarioLiquido(otherDeductions);
  const inssCents = calcularInssSalarioLiquido(grossCents, taxTable);
  const irrfResult = calcularIrrfSalarioLiquido(grossCents, inssCents, dependents, taxTable);
  const totalDeductionsCents = inssCents + irrfResult.taxCents + otherDeductionsCents;
  const netCents = Math.max(0, grossCents - totalDeductionsCents);
  const totalDiscountPercent = grossCents > 0 ? totalDeductionsCents / grossCents : 0;
  const percentage = new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(totalDiscountPercent);

  renderTableResult(
    result,
    `Resultado do salário líquido (${referenceYear})`,
    [
      ['Salário bruto', grossCents / 100, 'earning'],
      ['INSS', inssCents / 100, 'discount'],
      ['Base de cálculo do IRRF', irrfResult.taxableBaseCents / 100, 'earning'],
      ['IRRF', irrfResult.taxCents / 100, 'discount'],
      ['Outros descontos', otherDeductionsCents / 100, 'discount'],
      ['Salário líquido', netCents / 100, 'total']
    ],
    'Como chegamos ao seu salário líquido: o INSS foi calculado progressivamente conforme as faixas de contribuição de 2026; o IRRF considera dependentes e as regras mensais de tributação de 2026; outros descontos informados foram abatidos somente no resultado final. Este é um cálculo estimativo para empregado CLT e pode não refletir todos os descontos ou verbas existentes no contracheque real.',
    `<p class="mt-3 text-sm text-slate-700">Dedução usada no IRRF: <strong>${irrfResult.deductionMethod}</strong> (${money(irrfResult.appliedDeductionCents / 100)}).</p><p class="mt-2 text-sm text-slate-700">Percentual total de descontos: <strong>${percentage}</strong>.</p>`
  );
});

const today = new Date();
const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
rescisaoForm.elements.namedItem('admissao').max = localToday;
rescisaoForm.elements.namedItem('desligamento').max = localToday;
document.getElementById('current-year').textContent = String(today.getFullYear());
