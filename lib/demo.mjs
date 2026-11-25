// Demo account and two demo patients. Fictional people only.
export const DEMO_DOCTOR = {
  id: 'demo-doctor',
  email: 'doctor@aman.demo',
  password: '123456',
  name: 'د. ريم العتيبي',
  specialty: 'استشارية أعصاب',
  phone: '012 555 0147',
};

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

export function demoPatients() {
  return [
    {
      id: 'demo-sara',
      pin: '6305',
      band: 'demo-sara',
      wallet: 'demo-sara-wallet',
      data: {
        name: 'سارة أحمد', age: 34, sex: 'أنثى',
        conditions: ['MG'],
        diagnosisNote: 'الوهن العضلي الوبيل العام (Generalized Myasthenia Gravis)',
        diagnosisYear: '2021',
        contacts: [{ name: 'نورة', relation: 'الأم', phone: '055 555 0123' }],
        doctorName: 'د. ريم العتيبي', doctorSpecialty: 'استشارية أعصاب', doctorPhone: '012 555 0147',
        meds: [
          { name: 'بيريدوستيغمين (Mestinon)', dose: '60 ملغ', when: '4 مرات يوميًا: 6 ص، 12 ظ، 6 م، 12 ل' },
          { name: 'بريدنيزولون (Prednisolone)', dose: '20 ملغ', when: 'مرة يوميًا صباحًا' },
          { name: 'أزاثيوبرين (Azathioprine)', dose: '100 ملغ', when: 'مرة يوميًا' },
        ],
        history: {
          episodes: 'مارس 2026: ضعف شديد وصعوبة تنفس، دخول العناية المركزة 4 أيام.\nيونيو 2024: زيادة ضعف وصعوبة بلع، تنويم 6 أيام.',
          treatments: 'مارس 2026: IVIG لمدة 5 أيام.\nيونيو 2024: تبديل البلازما، 5 جلسات.',
          conditions: 'استئصال الغدة الزعترية عام 2022.\nحساسية البنسلين: طفح جلدي في الطفولة حسب كلام الأهل (مسجلة في قسم الحساسية).\nلا توجد أمراض مزمنة أخرى.',
          tests: 'مايو 2021: أجسام مضادة لمستقبلات الأستيل كولين، إيجابي.\nمايو 2021: تخطيط الأعصاب، متوافق مع التشخيص.',
        },
        plan: '1. عند صعوبة التنفس أو الصوت الضعيف أو الكحة الضعيفة أو صعوبة البلع: راقب التنفس واتصل بطبيب الأعصاب فورًا.\n2. لا تعطِ أي دواء من القائمة الحمراء.\n3. لا توقف البريدنيزولون فجأة.\n4. استمر على البيريدوستيغمين إلا إذا قرر الطبيب غير ذلك.\n5. تواصل مع الطبيب المعالج.',
        removedRules: [], customAvoid: [],
        // Penicillin label from childhood: shows the allergy check (Augmentin) and the low-risk flag.
        allergies: [{ group: 'penicillin', name: '', reaction: 'rash', year: '2003', certainty: 'reported', note: 'طفح بعد شراب مضاد حيوي وهي طفلة.' }],
        lastConfirmedAt: daysAgo(26),
      },
    },
    {
      id: 'demo-yousef',
      pin: '2580',
      band: 'demo-yousef',
      wallet: 'demo-yousef-wallet',
      data: {
        name: 'يوسف خالد', age: 6, sex: 'ذكر',
        conditions: ['G6PD'],
        diagnosisNote: 'نقص إنزيم G6PD (اكتُشف في فحص حديثي الولادة)',
        diagnosisYear: '2020',
        contacts: [{ name: 'خالد', relation: 'الأب (ولي الأمر)', phone: '050 555 0188' }],
        doctorName: 'د. فهد الحربي', doctorSpecialty: 'طب الأطفال', doctorPhone: '012 555 0190',
        meds: [],
        history: {
          episodes: 'أغسطس 2023: نوبة تكسّر دم بعد أكل الفول، تنويم 3 أيام ونقل دم.',
          treatments: 'أغسطس 2023: نقل دم مرة واحدة.',
          conditions: 'لا توجد حساسية معروفة.',
          tests: '2020: فحص حديثي الولادة، نقص إنزيم G6PD.\n2023: نشاط الإنزيم منخفض (تأكيد).',
        },
        plan: '1. عند بول داكن (بلون الشاي) أو شحوب أو اصفرار: راجع الطوارئ فورًا.\n2. لا تعطِ أي دواء من القائمة الحمراء.\n3. أي التهاب أو حرارة قد يسبب تكسّر الدم: راقب العلامات.\n4. تجنّب الفول والنفثالين (كرات العث).',
        removedRules: [], customAvoid: [],
        lastConfirmedAt: daysAgo(54),
      },
    },
    {
      // Faisal: a real NFC bracelet is already written with /m/5RPNwhpEcP, so this link must never change.
      id: 'demo-faisal',
      pin: '4417',
      band: '5RPNwhpEcP',
      wallet: 'demo-faisal-wallet',
      data: {
        name: 'فيصل الغامدي', age: 28, sex: 'ذكر',
        conditions: ['MG'],
        diagnosisNote: 'الوهن العضلي الوبيل العام (Generalized Myasthenia Gravis)',
        diagnosisYear: '2022',
        contacts: [{ name: 'نوف الغامدي', relation: 'الأم', phone: '0531212199' }],
        doctorName: 'د. ريم العتيبي', doctorSpecialty: 'استشارية أعصاب', doctorPhone: '012 555 0147',
        meds: [
          { name: 'بيريدوستيغمين (Mestinon)', dose: '60 ملغ', when: '4 مرات يوميًا: 6 ص، 12 ظ، 6 م، 12 ل' },
          { name: 'بريدنيزولون (Prednisolone)', dose: '20 ملغ', when: 'مرة يوميًا صباحًا' },
          { name: 'أزاثيوبرين (Azathioprine)', dose: '100 ملغ', when: 'مرة يوميًا' },
        ],
        history: {
          episodes: 'أغسطس 2025: ضعف شديد وصعوبة تنفس بعد مضاد حيوي، دخول العناية المركزة 5 أيام.\nيناير 2024: ازدواج رؤية وصعوبة بلع، تنويم 4 أيام.',
          treatments: 'أغسطس 2025: IVIG لمدة 5 أيام.\nيناير 2024: تبديل البلازما، 5 جلسات.',
          conditions: 'استئصال الغدة الزعترية عام 2023.\nحساسية البنسلين: طفح جلدي وتورم بعد أموكسيسيلين عام 2019 (مسجلة في قسم الحساسية).',
          tests: 'مارس 2022: أجسام مضادة لمستقبلات الأستيل كولين، إيجابي.\nمارس 2022: تخطيط الأعصاب، متوافق مع التشخيص.',
        },
        plan: '1. عند صعوبة التنفس أو الصوت الضعيف أو الكحة الضعيفة أو صعوبة البلع: راقب التنفس واتصل بطبيب الأعصاب فورًا.\n2. لا تعطِ أي دواء من القائمة الحمراء.\n3. لا تعطِ البنسلين أو مشتقاته.',
        removedRules: [], customAvoid: [],
        autoNotify: true,
        allergies: [{ group: 'penicillin', name: 'أموكسيسيلين', reaction: 'hives', year: '2019', certainty: 'documented', note: 'طفح جلدي وتورم بعد أموكسيسيلين.' }],
        lastConfirmedAt: daysAgo(3),
      },
    },
  ];
}

// Demo barcodes use the GS1 "restricted circulation" prefix 20, so they can never
// collide with a real product. They are printed on the /demo-barcodes page.
export const DEMO_BARCODES = [
  { gtin: '02000001000014', key: 'ciprofloxacin', label: 'Ciprofloxacin 500 mg (علبة تجريبية)' },
  { gtin: '02000001000021', key: 'ibuprofen', label: 'Ibuprofen 400 mg (علبة تجريبية)' },
  { gtin: '02000001000038', key: 'azithromycin', label: 'Azithromycin 250 mg (علبة تجريبية)' },
  { gtin: '02000001000045', key: 'paracetamol', label: 'Paracetamol 500 mg (علبة تجريبية)' },
  { gtin: '02000001000052', key: 'co-trimoxazole', label: 'Co-trimoxazole 480 mg (علبة تجريبية)' },
  { gtin: '02000001000069', key: 'primaquine', label: 'Primaquine 15 mg (علبة تجريبية)' },
  { gtin: '02000001000076', key: 'amoxicillin-clavulanate', label: 'Amoxicillin/Clavulanate 1 g (علبة تجريبية)' },
  { gtin: '02000001000083', key: 'cefuroxime', label: 'Cefuroxime 500 mg (علبة تجريبية)' },
];
