/* ---------------- state ---------------- */
let DB = { services: [], patients: [], bookings: [], settings: { clinicName:'عيادة الابتسامة', clinicPhone:'', webhookUrl:'', syncWebhookUrl:'' } };
let syncTimer = null;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);

const todayStr = () => new Date().toISOString().slice(0,10);

async function loadDB(){
  try{
    const raw = localStorage.getItem('clinic-db');
    if(raw){ DB = JSON.parse(raw); }
  }catch(e){ /* first run, no data yet */ }
  if(!DB.services) DB.services=[];
  if(!DB.patients) DB.patients=[];
  if(!DB.bookings) DB.bookings=[];
  if(!DB.settings) DB.settings={clinicName:'عيادة الابتسامة',clinicPhone:'',webhookUrl:'',syncWebhookUrl:''};
  if(DB.settings.syncWebhookUrl===undefined) DB.settings.syncWebhookUrl='';

  if(DB.services.length===0){
    DB.services = [
      {id:uid(), name:'كشف وتنظيف أسنان', desc:'كشف عام وتنظيف الجير والتلميع', price:300, duration:30},
      {id:uid(), name:'حشو أسنان', desc:'حشو تجميلي أبيض للأسنان المصابة بالتسوس', price:450, duration:40},
      {id:uid(), name:'تبييض أسنان', desc:'جلسة تبييض بالليزر أو الكاسات المنزلية', price:1500, duration:60},
      {id:uid(), name:'تقويم أسنان (استشارة)', desc:'كشف وتقييم أولي لحالة التقويم', price:250, duration:30},
    ];
    await saveDB();
  }
}

async function saveDB(){
  try{
    localStorage.setItem('clinic-db', JSON.stringify(DB));
  }catch(e){
    console.error('storage error', e);
    showToast('حصل خطأ في حفظ البيانات');
  }
}

/* ---------------- tabs ---------------- */
document.getElementById('tabs').addEventListener('click', e=>{
  const btn = e.target.closest('button[data-tab]');
  if(!btn) return;
  switchTab(btn.dataset.tab);
});
function switchTab(tab){
  document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+tab).classList.add('active');
  render();
}

/* ---------------- toast ---------------- */
let toastTimer;
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 2600);
}

/* ---------------- webhook ---------------- */
async function sendWebhook(payload){
  const url = DB.settings.webhookUrl;
  if(!url) return {sent:false, reason:'no-url'};
  try{
    await fetch(url, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    return {sent:true};
  }catch(e){
    console.error('webhook error', e);
    return {sent:false, reason:e.message};
  }
}

/* ---------------- sync from n8n (Google Sheets) ---------------- */
// بيجيب أحدث الحجوزات من n8n (اللي بيقرأها من جوجل شيت) ويحدث القاعدة المحلية بيها
async function fetchBookingsFromSheet(silent){
  const url = DB.settings.syncWebhookUrl;
  if(!url) return {ok:false, reason:'no-url'};
  try{
    const res = await fetch(url, { method:'GET' });
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json();
    // n8n ممكن يرجع array مباشرة أو object فيه مفتاح bookings/data
    const rows = Array.isArray(data) ? data : (data.bookings || data.data || []);
    mergeBookingsFromSheet(rows);
    await saveDB();
    render();
    if(!silent) showToast('تم تحديث الحجوزات ✓');
    return {ok:true, count: rows.length};
  }catch(e){
    console.error('sync error', e);
    if(!silent) showToast('فشل تحديث الحجوزات — تأكد من رابط المزامنة');
    return {ok:false, reason:e.message};
  }
}

// بيدمج الصفوف الجايه من الشيت مع الحجوزات المحلية من غير تكرار
function mergeBookingsFromSheet(rows){
  rows.forEach(row=>{
    // استخدم id لو موجود من الشيت، وإلا اعمل مفتاح فريد من الاسم+التاريخ+الوقت
    const sheetId = row.id || row.bookingId || null;
    const matchKey = b => sheetId ? (b.sheetId===sheetId) :
      (b.patientName===row.patientName && b.date===row.date && b.time===row.time);

    const existing = DB.bookings.find(matchKey);
    const booking = {
      id: existing ? existing.id : uid(),
      sheetId: sheetId || (existing && existing.sheetId) || null,
      patientId: existing ? existing.patientId : (row.patientId || uid()),
      patientName: row.patientName || row.name || '',
      phone: row.phone || '',
      serviceId: existing ? existing.serviceId : (row.serviceId || ''),
      serviceName: row.serviceName || row.service || '',
      date: row.date || '',
      time: row.time || '',
      status: row.status || (existing ? existing.status : 'confirmed'),
      notes: row.notes || ''
    };
    if(existing){
      DB.bookings = DB.bookings.map(b=> b.id===existing.id ? booking : b);
    } else {
      DB.bookings.push(booking);
    }
  });
}

// تشغيل/إيقاف المزامنة الدورية
function startAutoSync(){
  stopAutoSync();
  if(!DB.settings.syncWebhookUrl) return;
  fetchBookingsFromSheet(true); // أول تحديث فورًا
  syncTimer = setInterval(()=>fetchBookingsFromSheet(true), 30000); // كل 30 ثانية
}
function stopAutoSync(){
  if(syncTimer){ clearInterval(syncTimer); syncTimer=null; }
}

/* ---------------- render: home ---------------- */
function render(){
  renderHome();
  renderServices();
  renderBookings();
  renderPatients();
  renderSettings();
}

function renderHome(){
  const d = new Date();
  const days=['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  document.getElementById('heroDate').textContent = `أهلًا بيك، النهارده ${days[d.getDay()]} ${d.toLocaleDateString('ar-EG')}`;

  const t = todayStr();
  const todayBookings = DB.bookings.filter(b=>b.date===t).sort((a,b)=>a.time.localeCompare(b.time));
  document.getElementById('statToday').textContent = todayBookings.length;
  document.getElementById('statPatients').textContent = DB.patients.length;
  document.getElementById('statServices').textContent = DB.services.length;
  const curMonth = t.slice(0,7);
  document.getElementById('statMonth').textContent = DB.bookings.filter(b=>b.date.startsWith(curMonth)).length;
  document.getElementById('todayCount').textContent = todayBookings.length;

  // smile arc
  const arc = document.getElementById('smileArc');
  arc.innerHTML='';
  const slots = todayBookings.length ? todayBookings.slice(0,9) : [];
  const n = Math.max(slots.length, 5);
  for(let i=0;i<n;i++){
    const dot = document.createElement('div');
    dot.className='tooth-dot'+(slots[i]?'':' empty');
    const mid=(n-1)/2;
    const offset = Math.round(Math.pow(Math.abs(i-mid),1.6)*3);
    dot.style.marginBottom = offset+'px';
    dot.textContent = slots[i] ? slots[i].time.slice(0,5) : '🦷';
    if(slots[i]) dot.title = slots[i].patientName;
    arc.appendChild(dot);
  }

  const list = document.getElementById('todayBookingsList');
  if(todayBookings.length===0){
    list.innerHTML = `<div class="card empty-state"><div class="big">🗓️</div>مفيش حجوزات النهارده لسه.<br><button class="btn btn-teal btn-sm" style="margin-top:12px" onclick="openBookingModal()">+ إضافة حجز</button></div>`;
  } else {
    list.innerHTML = bookingsTableHTML(todayBookings);
  }
}

/* ---------------- render: services ---------------- */
function renderServices(){
  const q = (document.getElementById('serviceSearch').value||'').trim();
  const items = DB.services.filter(s=>s.name.includes(q));
  document.getElementById('servicesCount').textContent = DB.services.length;
  const grid = document.getElementById('servicesGrid');
  if(items.length===0){
    grid.innerHTML = `<div class="card empty-state" style="grid-column:1/-1"><div class="big">🦷</div>مفيش خدمات مطابقة.</div>`;
    return;
  }
  grid.innerHTML = items.map(s=>`
    <div class="service-card">
      <h3>${esc(s.name)}</h3>
      <div class="price">${s.price} جنيه</div>
      <div class="desc">${esc(s.desc||'')}</div>
      <div class="meta">⏱ ${s.duration||0} دقيقة</div>
      <div class="row">
        <button class="btn btn-outline btn-sm" onclick="openServiceModal('${s.id}')">تعديل</button>
        <button class="btn btn-danger btn-sm" onclick="deleteService('${s.id}')">حذف</button>
      </div>
    </div>`).join('');
}
document.getElementById('serviceSearch').addEventListener('input', renderServices);

function openServiceModal(id){
  document.getElementById('serviceId').value = id||'';
  const s = DB.services.find(x=>x.id===id);
  document.getElementById('serviceModalTitle').textContent = s?'تعديل الخدمة':'إضافة خدمة';
  document.getElementById('serviceName').value = s?s.name:'';
  document.getElementById('serviceDesc').value = s?s.desc:'';
  document.getElementById('servicePrice').value = s?s.price:'';
  document.getElementById('serviceDuration').value = s?s.duration:'';
  openModal('modalService');
}
async function saveService(){
  const id = document.getElementById('serviceId').value;
  const name = document.getElementById('serviceName').value.trim();
  if(!name){ showToast('اكتب اسم الخدمة'); return; }
  const obj = {
    id: id||uid(),
    name,
    desc: document.getElementById('serviceDesc').value.trim(),
    price: Number(document.getElementById('servicePrice').value)||0,
    duration: Number(document.getElementById('serviceDuration').value)||0,
  };
  if(id){ DB.services = DB.services.map(s=>s.id===id?obj:s); }
  else DB.services.push(obj);
  await saveDB();
  closeModal('modalService');
  render();
  showToast('تم حفظ الخدمة');
}
async function deleteService(id){
  if(!confirm('تأكيد حذف الخدمة؟')) return;
  DB.services = DB.services.filter(s=>s.id!==id);
  await saveDB();
  render();
  showToast('تم الحذف');
}

/* ---------------- render: bookings ---------------- */
function bookingsTableHTML(list){
  if(list.length===0) return `<div class="card empty-state">مفيش حجوزات.</div>`;
  const statusLabel = {confirmed:'مؤكد',done:'تم',cancelled:'ملغي'};
  return `<div class="table-wrap"><table><thead><tr>
    <th>المريض</th><th>الهاتف</th><th>الخدمة</th><th>التاريخ</th><th>الوقت</th><th>الحالة</th><th></th>
  </tr></thead><tbody>
  ${list.map(b=>`
    <tr>
      <td>${esc(b.patientName)}</td>
      <td dir="ltr" style="text-align:right">${esc(b.phone||'')}</td>
      <td>${esc(b.serviceName)}</td>
      <td>${b.date}</td>
      <td>${b.time}</td>
      <td><span class="pill pill-${b.status}">${statusLabel[b.status]}</span></td>
      <td>
        <div class="row-actions">
          ${b.status==='confirmed'?`<button class="btn btn-outline btn-sm" onclick="setBookingStatus('${b.id}','done')">تم</button>
          <button class="btn btn-danger btn-sm" onclick="setBookingStatus('${b.id}','cancelled')">إلغاء</button>`:''}
          <button class="btn btn-outline btn-sm" onclick="deleteBooking('${b.id}')">حذف</button>
        </div>
      </td>
    </tr>`).join('')}
  </tbody></table></div>`;
}

function renderBookings(){
  const filterDate = document.getElementById('bookingDateFilter').value;
  let list = [...DB.bookings].sort((a,b)=> (a.date+a.time).localeCompare(b.date+b.time));
  if(filterDate) list = list.filter(b=>b.date===filterDate);
  document.getElementById('bookingsCount').textContent = DB.bookings.length;
  document.getElementById('bookingsTableWrap').innerHTML = bookingsTableHTML(list);
}
document.getElementById('bookingDateFilter').addEventListener('change', renderBookings);
function clearDateFilter(){ document.getElementById('bookingDateFilter').value=''; renderBookings(); }

function openBookingModal(){
  document.getElementById('bookingId').value='';
  document.getElementById('bookingModalTitle').textContent='حجز ميعاد جديد';
  const sel = document.getElementById('bookingPatientSelect');
  sel.innerHTML = '<option value="__new__">+ مريض جديد</option>' +
    DB.patients.map(p=>`<option value="${p.id}">${esc(p.name)} — ${esc(p.phone)}</option>`).join('');
  sel.value='__new__';
  toggleNewPatientFields();
  const svcSel = document.getElementById('bookingServiceSelect');
  svcSel.innerHTML = DB.services.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
  document.getElementById('bookingDate').value = todayStr();
  document.getElementById('bookingTime').value = '';
  document.getElementById('bookingNotes').value='';
  document.getElementById('bookingNewName').value='';
  document.getElementById('bookingNewPhone').value='';
  openModal('modalBooking');
}
function toggleNewPatientFields(){
  const isNew = document.getElementById('bookingPatientSelect').value==='__new__';
  document.getElementById('newPatientFields').style.display = isNew ? 'block':'none';
}
async function saveBooking(){
  const patSel = document.getElementById('bookingPatientSelect').value;
  const svcId = document.getElementById('bookingServiceSelect').value;
  const service = DB.services.find(s=>s.id===svcId);
  const date = document.getElementById('bookingDate').value;
  const time = document.getElementById('bookingTime').value;
  if(!date || !time){ showToast('حدد التاريخ والوقت'); return; }
  if(!service){ showToast('حدد الخدمة'); return; }

  let patientId, patientName, phone;
  if(patSel==='__new__'){
    const name = document.getElementById('bookingNewName').value.trim();
    const ph = document.getElementById('bookingNewPhone').value.trim();
    if(!name || !ph){ showToast('اكتب اسم ورقم هاتف المريض'); return; }
    const newPatient = { id: uid(), name, phone: ph, age:'', address:'', history:'' };
    DB.patients.push(newPatient);
    patientId = newPatient.id; patientName = name; phone = ph;
  } else {
    const p = DB.patients.find(x=>x.id===patSel);
    patientId = p.id; patientName = p.name; phone = p.phone;
  }

  const booking = {
    id: uid(), patientId, patientName, phone,
    serviceId: service.id, serviceName: service.name,
    date, time, status:'confirmed',
    notes: document.getElementById('bookingNotes').value.trim()
  };
  DB.bookings.push(booking);
  await saveDB();
  closeModal('modalBooking');
  render();
  showToast('تم حفظ الحجز');

  const r = await sendWebhook({ event:'new_booking', ...booking, clinic: DB.settings.clinicName });
  if(r.sent) showToast('تم إرسال بيانات الحجز لـ n8n ✓');
}
async function setBookingStatus(id, status){
  const b = DB.bookings.find(x=>x.id===id);
  if(!b) return;
  b.status = status;
  await saveDB();
  render();
  const r = await sendWebhook({ event: status==='cancelled'?'booking_cancelled':'booking_updated', ...b, clinic: DB.settings.clinicName });
  showToast(status==='done'?'تم تحديد الحجز كمكتمل':'تم إلغاء الحجز');
}
async function deleteBooking(id){
  if(!confirm('تأكيد حذف الحجز؟')) return;
  DB.bookings = DB.bookings.filter(b=>b.id!==id);
  await saveDB();
  render();
  showToast('تم الحذف');
}

/* ---------------- render: patients ---------------- */
function renderPatients(){
  const q = (document.getElementById('patientSearch').value||'').trim();
  const items = DB.patients.filter(p=>p.name.includes(q) || (p.phone||'').includes(q));
  document.getElementById('patientsCount').textContent = DB.patients.length;
  const wrap = document.getElementById('patientsTableWrap');
  if(items.length===0){
    wrap.innerHTML = `<div class="card empty-state"><div class="big">🗂️</div>مفيش مرضى مسجلين لسه.</div>`;
    return;
  }
  wrap.innerHTML = `<div class="table-wrap"><table><thead><tr>
    <th>الاسم</th><th>الهاتف</th><th>السن</th><th>عدد الزيارات</th><th></th>
  </tr></thead><tbody>
  ${items.map(p=>{
    const visits = DB.bookings.filter(b=>b.patientId===p.id).length;
    return `<tr>
      <td>${esc(p.name)}</td>
      <td dir="ltr" style="text-align:right">${esc(p.phone||'')}</td>
      <td>${p.age||'—'}</td>
      <td>${visits}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-outline btn-sm" onclick="viewPatient('${p.id}')">عرض الملف</button>
          <button class="btn btn-outline btn-sm" onclick="openPatientModal('${p.id}')">تعديل</button>
          <button class="btn btn-danger btn-sm" onclick="deletePatient('${p.id}')">حذف</button>
        </div>
      </td>
    </tr>`;
  }).join('')}
  </tbody></table></div>`;
}
document.getElementById('patientSearch').addEventListener('input', renderPatients);

function openPatientModal(id){
  document.getElementById('patientId').value = id||'';
  const p = DB.patients.find(x=>x.id===id);
  document.getElementById('patientModalTitle').textContent = p?'تعديل بيانات المريض':'إضافة مريض';
  document.getElementById('patientName').value = p?p.name:'';
  document.getElementById('patientAge').value = p?p.age:'';
  document.getElementById('patientPhone').value = p?p.phone:'';
  document.getElementById('patientAddress').value = p?p.address:'';
  document.getElementById('patientHistory').value = p?p.history:'';
  openModal('modalPatient');
}
async function savePatient(){
  const id = document.getElementById('patientId').value;
  const name = document.getElementById('patientName').value.trim();
  const phone = document.getElementById('patientPhone').value.trim();
  if(!name || !phone){ showToast('اكتب الاسم ورقم الهاتف'); return; }
  const obj = {
    id: id||uid(), name, phone,
    age: document.getElementById('patientAge').value,
    address: document.getElementById('patientAddress').value.trim(),
    history: document.getElementById('patientHistory').value.trim(),
  };
  if(id){
    DB.patients = DB.patients.map(p=>p.id===id?obj:p);
    DB.bookings = DB.bookings.map(b=> b.patientId===id ? {...b, patientName:name, phone} : b);
  } else DB.patients.push(obj);
  await saveDB();
  closeModal('modalPatient');
  render();
  showToast('تم حفظ بيانات المريض');
}
async function deletePatient(id){
  if(!confirm('تأكيد حذف ملف المريض؟ (لن يتم حذف الحجوزات السابقة)')) return;
  DB.patients = DB.patients.filter(p=>p.id!==id);
  await saveDB();
  render();
  showToast('تم الحذف');
}
function viewPatient(id){
  const p = DB.patients.find(x=>x.id===id);
  if(!p) return;
  const visits = DB.bookings.filter(b=>b.patientId===id).sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
  document.getElementById('patientDetailContent').innerHTML = `
    <h3>${esc(p.name)}</h3>
    <div class="field"><label>رقم الهاتف</label><div>${esc(p.phone||'—')}</div></div>
    <div class="field"><label>السن</label><div>${esc(p.age||'—')}</div></div>
    <div class="field"><label>العنوان</label><div>${esc(p.address||'—')}</div></div>
    <div class="field"><label>التاريخ المرضي</label><div>${esc(p.history||'—')}</div></div>
    <div class="field"><label>سجل الزيارات (${visits.length})</label>
      ${visits.length? `<table><thead><tr><th>التاريخ</th><th>الخدمة</th><th>الحالة</th></tr></thead><tbody>
        ${visits.map(v=>`<tr><td>${v.date} ${v.time}</td><td>${esc(v.serviceName)}</td><td>${v.status}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty-state">لا توجد زيارات سابقة</div>'}
    </div>
    <div class="modal-actions"><button class="btn btn-outline" onclick="closeModal('modalPatientDetail')">إغلاق</button></div>
  `;
  openModal('modalPatientDetail');
}

/* ---------------- settings ---------------- */
function renderSettings(){
  document.getElementById('setClinicName').value = DB.settings.clinicName||'';
  document.getElementById('setClinicPhone').value = DB.settings.clinicPhone||'';
  document.getElementById('setWebhookUrl').value = DB.settings.webhookUrl||'';
  const syncEl = document.getElementById('setSyncWebhookUrl');
  if(syncEl) syncEl.value = DB.settings.syncWebhookUrl||'';
}
async function saveSettings(){
  DB.settings.clinicName = document.getElementById('setClinicName').value.trim();
  DB.settings.clinicPhone = document.getElementById('setClinicPhone').value.trim();
  DB.settings.webhookUrl = document.getElementById('setWebhookUrl').value.trim();
  const syncEl = document.getElementById('setSyncWebhookUrl');
  if(syncEl) DB.settings.syncWebhookUrl = syncEl.value.trim();
  await saveDB();
  showToast('تم حفظ الإعدادات');
  startAutoSync(); // يشغّل المزامنة على طول لو الرابط اتغيّر
}
async function testWebhook(){
  const box = document.getElementById('webhookStatus');
  box.innerHTML='';
  if(!DB.settings.webhookUrl){
    box.innerHTML = `<div class="status-msg status-err">اكتب رابط الـ Webhook الأول واحفظه</div>`;
    return;
  }
  const r = await sendWebhook({event:'test_connection', message:'رسالة اختبار من نظام عيادة الابتسامة', clinic: DB.settings.clinicName, timestamp: new Date().toISOString()});
  if(r.sent){
    box.innerHTML = `<div class="status-msg status-ok">تم إرسال طلب الاختبار بنجاح. تأكد من الاستلام في n8n.</div>`;
  } else {
    box.innerHTML = `<div class="status-msg status-err">فشل الإرسال — تأكد إن الرابط صحيح وإن n8n يسمح بالاتصال من المتصفح (CORS).</div>`;
  }
}

/* ---------------- modal helpers ---------------- */
function openModal(id){ document.getElementById(id).classList.add('active'); }
function closeModal(id){ document.getElementById(id).classList.remove('active'); }
document.querySelectorAll('.overlay').forEach(ov=>{
  ov.addEventListener('click', e=>{ if(e.target===ov) ov.classList.remove('active'); });
});
function esc(s){ return (s??'').toString().replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------------- init ---------------- */
(async function init(){
  await loadDB();
  document.getElementById('bookingDate') && (document.getElementById('bookingDate').min = todayStr());
  render();
  startAutoSync(); // يبدأ تحديث الحجوزات من n8n تلقائيًا كل 30 ثانية لو الرابط متسجل
})();
