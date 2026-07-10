/* ============================================================
   MartAI "Saathi" — cartoon AI assistant for RD MART
   - Animated cartoon robot character (blinks, talks, waves)
   - Understands & replies in English / नेपाली / हिंदी
   - Speaks replies (text-to-speech) + mic voice input
   - Performs real tasks: dues, credits, payments, customers,
     sales, navigation, backup, CSV, sync, theme, WhatsApp…
   Self-contained: injects its own CSS + DOM. Just include it.
   ============================================================ */
(function(){
'use strict';
if(window.__MARTAI_BOT__)return;window.__MARTAI_BOT__=true;

/* ---------- mode + state ---------- */
const MODE=document.getElementById('page-dashboard')?'dash':(document.querySelector('.customer-tab')?'cust':'login');
const LS_LANG='martai_bot_lang',LS_VOICE='martai_bot_voice';
let lang=localStorage.getItem(LS_LANG);if(!['en','ne','hi'].includes(lang))lang='ne';
let voiceOn=localStorage.getItem(LS_VOICE)!=='off';
let flow=null,listening=false,recog=null,greeted=false,bubbleTimer=null;

const M=()=>window.MartAI;
const esc=v=>String(v??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[m]));
const money=v=>M()&&M().money?M().money(v):'Rs '+Number(v||0).toLocaleString('en-IN');
const num=v=>{const n=Number(String(v??'').replace(/,/g,''));return Number.isFinite(n)?n:0};

/* ---------- i18n ---------- */
const L=(en,ne,hi)=>({en,ne,hi});
const UI={
  name:L('Saathi','साथी','साथी'),
  sub:L('RD MART assistant · online','RD MART सहयोगी · अनलाइन','RD MART सहायक · ऑनलाइन'),
  ph:L('Type or tap 🎤 and speak…','टाइप गर्नुहोस् वा 🎤 थिचेर बोल्नुहोस्…','टाइप करें या 🎤 दबाकर बोलें…'),
  yes:L('✅ Yes, do it','✅ हुन्छ, गर्नुहोस्','✅ हाँ, कर दो'),
  no:L('❌ No, cancel','❌ रद्द गर्नुहोस्','❌ नहीं, रद्द करें')
};
const T={
  greet:L("Namaste! 🙏 I'm <b>Saathi</b>, your RD MART helper robot. I can check dues, add credit, record payments, open pages, take backups and much more — in English, नेपाली or हिंदी. Tap a button below or just tell me!",
    "नमस्ते! 🙏 म <b>साथी</b>, तपाईंको RD MART सहयोगी रोबोट। म उधारो हेर्न, क्रेडिट थप्न, भुक्तानी लेख्न, पेज खोल्न, ब्याकअप लिन — धेरै काम गर्न सक्छु। तलको बटन थिच्नुहोस् वा मलाई भन्नुहोस्!",
    "नमस्ते! 🙏 मैं <b>साथी</b>, आपका RD MART सहायक रोबोट। मैं उधार देखना, क्रेडिट जोड़ना, भुगतान दर्ज करना, पेज खोलना, बैकअप लेना — बहुत कुछ कर सकता हूँ। नीचे बटन दबाइए या मुझे बताइए!"),
  greetBack:L('Namaste! 🙏 How can I help you today?','नमस्ते! 🙏 आज के गर्दिऊँ?','नमस्ते! 🙏 आज क्या मदद करूँ?'),
  howAreYou:L("I'm great and fully charged! 🔋 How can I help?","म एकदम ठिक छु, फुल चार्ज! 🔋 भन्नुहोस्, के गर्दिऊँ?","मैं एकदम बढ़िया हूँ, फुल चार्ज! 🔋 बताइए, क्या करूँ?"),
  whoAmI:L("I'm <b>Saathi</b> 🤖 — RD MART's own assistant. I live inside this app and can do real work for you: dues, credits, payments, reports, backup and more. Say <b>help</b> to see everything.",
    "म <b>साथी</b> 🤖 — RD MART कै आफ्नै सहयोगी। म यही एपभित्र बस्छु र साँच्चै काम गरिदिन्छु: उधारो, क्रेडिट, भुक्तानी, रिपोर्ट, ब्याकअप। <b>मद्दत</b> भन्नुहोस् त, सबै देखाउँछु।",
    "मैं <b>साथी</b> 🤖 — RD MART का अपना सहायक। मैं इसी ऐप में रहता हूँ और असली काम करता हूँ: उधार, क्रेडिट, भुगतान, रिपोर्ट, बैकअप। <b>मदद</b> बोलिए, सब दिखाऊँगा।"),
  thanks:L('You are welcome! 😊 Anything else?','स्वागत छ! 😊 अरू केही?','आपका स्वागत है! 😊 और कुछ?'),
  bye:L('Bye! 👋 I am always here at the corner.','धन्यवाद! 👋 म यही कुनामा छु, जहिले पनि बोलाउनुहोस्।','अलविदा! 👋 मैं यहीं कोने में हूँ, कभी भी बुलाइए।'),
  langSet:L('Done! I will speak English now. 🇬🇧','भयो! अब म नेपालीमा बोल्छु। 🇳🇵','हो गया! अब मैं हिंदी में बोलूँगा। 🇮🇳'),
  voiceOnMsg:L('🔊 Voice on — I will speak my replies.','🔊 आवाज खुल्यो — अब म बोलेर जवाफ दिन्छु।','🔊 आवाज़ चालू — अब मैं बोलकर जवाब दूँगा।'),
  voiceOffMsg:L('🔇 Voice off — I will reply silently.','🔇 आवाज बन्द — अब म चुपचाप लेखेर जवाफ दिन्छु।','🔇 आवाज़ बंद — अब मैं चुपचाप लिखकर जवाब दूँगा।'),
  noMic:L('Voice input is not supported in this browser. Please use Chrome or Edge.','यो ब्राउजरमा बोलेर इनपुट चल्दैन। कृपया Chrome वा Edge चलाउनुहोस्।','इस ब्राउज़र में बोलकर इनपुट नहीं चलता। कृपया Chrome या Edge चलाइए।'),
  micErr:L("I couldn't hear you. 🎤 Check mic permission and try again.","मैले सुन्न सकिनँ। 🎤 माइक अनुमति हेरेर फेरि बोल्नुहोस्।","मैं सुन नहीं पाया। 🎤 माइक अनुमति देखकर फिर बोलिए।"),
  timeIs:L('🕒 It is <b>{time}</b> · {ad}{bs}','🕒 अहिले <b>{time}</b> बज्यो · {ad}{bs}','🕒 अभी <b>{time}</b> बजे हैं · {ad}{bs}'),
  unknown:L("Hmm, I didn't understand that. 🤔 Say <b>help</b> to see what I can do.","बुझिनँ। 🤔 <b>मद्दत</b> भन्नुहोस् त, म के-के गर्न सक्छु देखाउँछु।","समझ नहीं आया। 🤔 <b>मदद</b> बोलिए, मैं क्या-क्या कर सकता हूँ दिखाता हूँ।"),
  searchBtn:L('🔎 Search "{q}" in records','🔎 "{q}" रेकर्डमा खोज्ने','🔎 "{q}" रिकॉर्ड में खोजें'),
  cancelled:L('Okay, cancelled. ❌ Nothing was saved.','हुन्छ, रद्द गरेँ। ❌ केही सेभ भएन।','ठीक है, रद्द कर दिया। ❌ कुछ सेव नहीं हुआ।'),
  error:L('⚠️ Could not do that: ','⚠️ मिलेन: ','⚠️ नहीं हो पाया: '),
  adminOnly:L('🔒 Only the main admin can do this.','🔒 यो काम मुख्य एडमिनले मात्र गर्न सक्छ।','🔒 यह काम केवल मुख्य एडमिन कर सकता है।'),
  navved:L('Opening <b>{p}</b> page. ✨','<b>{p}</b> पेज खोलेँ। ✨','<b>{p}</b> पेज खोल दिया। ✨'),
  synced:L('🔄 Synced with the online database!','🔄 अनलाइन डाटाबेससँग सिंक भयो!','🔄 ऑनलाइन डेटाबेस से सिंक हो गया!'),
  syncFail:L('⚠️ Sync problem: ','⚠️ सिंक समस्या: ','⚠️ सिंक समस्या: '),
  themeSet:L('🎨 Theme changed!','🎨 थिम फेरियो!','🎨 थीम बदल गई!'),
  backupDone:L('💾 Backup downloaded! Keep it somewhere safe.','💾 ब्याकअप डाउनलोड भयो! सुरक्षित ठाउँमा राख्नुहोस्।','💾 बैकअप डाउनलोड हो गया! सुरक्षित जगह रखिए।'),
  csvOffer:L('Which CSV do you want? 📄','कुन CSV चाहियो? 📄','कौन-सी CSV चाहिए? 📄'),
  duesTotal:L('💰 Total outstanding: <b>{amt}</b> from <b>{n}</b> customers.','💰 जम्मा उधारो बाँकी: <b>{amt}</b> ({n} जना ग्राहकबाट)।','💰 कुल बकाया उधार: <b>{amt}</b> ({n} ग्राहकों से)।'),
  noDues:L('🎉 Great news — nobody owes you anything right now!','🎉 खुसीको कुरा — अहिले कसैको उधारो बाँकी छैन!','🎉 खुशखबरी — अभी किसी का उधार बाकी नहीं है!'),
  topDues:L('🏆 Customers with highest dues:','🏆 सबैभन्दा धेरै उधारो भएका ग्राहक:','🏆 सबसे ज़्यादा उधार वाले ग्राहक:'),
  custNotFound:L('😕 No customer found for "<b>{q}</b>". Check the name or phone.','😕 "<b>{q}</b>" नामको ग्राहक भेटिएन। नाम वा फोन जाँच्नुहोस्।','😕 "<b>{q}</b>" नाम का ग्राहक नहीं मिला। नाम या फोन जाँचिए।'),
  custBalance:L('<b>{name}</b> ({phone})<br>Balance due: <b>{amt}</b> · Taken {taken} · Paid {paid}','<b>{name}</b> ({phone})<br>बाँकी: <b>{amt}</b> · लगेको {taken} · तिरेको {paid}','<b>{name}</b> ({phone})<br>बकाया: <b>{amt}</b> · लिया {taken} · चुकाया {paid}'),
  pickCustomer:L('I found more than one — who did you mean? 👇','एकभन्दा बढी भेटिए — कुन चाहिँ? 👇','एक से ज़्यादा मिले — किसकी बात है? 👇'),
  whoseBalance:L('Whose balance should I check? Tell me the name or phone.','कसको बाँकी हेर्ने? नाम वा फोन भन्नुहोस्।','किसका बकाया देखूँ? नाम या फोन बताइए।'),
  todayHead:L('📊 Today ({d}):','📊 आज ({d}):','📊 आज ({d}):'),
  monthHead:L('📅 This month ({m}):','📅 यो महिना ({m}):','📅 इस महीने ({m}):'),
  reqPending:L('🔔 <b>{n}</b> customer payment reports are waiting for approval. Check the dashboard.','🔔 <b>{n}</b> वटा ग्राहक भुक्तानी रिपोर्ट स्वीकृतिको पर्खाइमा छन्। ड्यासबोर्ड हेर्नुहोस्।','🔔 <b>{n}</b> ग्राहक भुगतान रिपोर्ट मंज़ूरी का इंतज़ार कर रही हैं। डैशबोर्ड देखिए।'),
  reqNone:L('✅ No pending payment reports right now.','✅ अहिले कुनै भुक्तानी रिपोर्ट बाँकी छैन।','✅ अभी कोई भुगतान रिपोर्ट बाकी नहीं है।'),
  chequeHead:L('🏦 Cheques on hold:','🏦 होल्डमा रहेका चेकहरू:','🏦 होल्ड पर रखे चेक:'),
  chequeNone:L('✅ No cheques are on hold.','✅ कुनै चेक होल्डमा छैन।','✅ कोई चेक होल्ड पर नहीं है।'),
  waSent:L('💬 WhatsApp opened with the reminder message — press send there.','💬 रिमाइन्डर सन्देशसहित WhatsApp खुल्यो — त्यहाँ send थिच्नुहोस्।','💬 रिमाइंडर संदेश के साथ WhatsApp खुल गया — वहाँ send दबाइए।'),
  loggedOut:L('👋 Logging you out…','👋 लगआउट गर्दैछु…','👋 लॉगआउट कर रहा हूँ…'),
  askName:L("👤 New customer — what is the customer's <b>name</b>? (type <i>cancel</i> to stop)","👤 नयाँ ग्राहक — ग्राहकको <b>नाम</b> के हो? (रोक्न <i>रद्द</i> लेख्नुहोस्)","👤 नया ग्राहक — ग्राहक का <b>नाम</b> क्या है? (रोकने के लिए <i>रद्द</i> लिखें)"),
  askPhone:L('📱 10-digit <b>phone number</b>?','📱 १० अङ्कको <b>फोन नम्बर</b>?','📱 10 अंकों का <b>फोन नंबर</b>?'),
  askPin:L('🔑 4-digit <b>PIN</b> for the customer portal login?','🔑 ग्राहक पोर्टल लगइनका लागि ४ अङ्कको <b>PIN</b>?','🔑 ग्राहक पोर्टल लॉगिन के लिए 4 अंकों का <b>PIN</b>?'),
  askCustomer:L('👤 Which customer? Tell me the name or phone.','👤 कुन ग्राहक? नाम वा फोन भन्नुहोस्।','👤 कौन-सा ग्राहक? नाम या फोन बताइए।'),
  askAmount:L('💵 Amount? (e.g. 500)','💵 रकम कति? (जस्तै ५००)','💵 रकम कितनी? (जैसे 500)'),
  askItems:L('🛒 Items / note? (or type <i>skip</i>)','🛒 सामान / नोट? (नभए <i>skip</i> लेख्नुहोस्)','🛒 सामान / नोट? (नहीं तो <i>skip</i> लिखें)'),
  askParty:L('🧾 Customer/party name? (or type <i>skip</i> for walk-in)','🧾 ग्राहक/पार्टीको नाम? (नभए <i>skip</i>)','🧾 ग्राहक/पार्टी का नाम? (नहीं तो <i>skip</i>)'),
  badPhone:L('⚠️ That is not a valid 10-digit phone. Try again.','⚠️ १० अङ्कको सही फोन भएन। फेरि भन्नुहोस्।','⚠️ सही 10 अंकों का फोन नहीं है। फिर बताइए।'),
  badPin:L('⚠️ PIN must be exactly 4 digits. Try again.','⚠️ PIN ठ्याक्कै ४ अङ्ककै हुनुपर्छ। फेरि भन्नुहोस्।','⚠️ PIN ठीक 4 अंकों का होना चाहिए। फिर बताइए।'),
  badAmount:L('⚠️ Please give an amount greater than 0.','⚠️ ० भन्दा बढी रकम भन्नुहोस्।','⚠️ 0 से ज़्यादा रकम बताइए।'),
  badName:L('⚠️ Name is too short. Try again.','⚠️ नाम मिलेन। फेरि भन्नुहोस्।','⚠️ नाम बहुत छोटा है। फिर बताइए।'),
  cfCustomer:L('Add customer <b>{name}</b> · 📱 {phone} · PIN {pin}. Save?','ग्राहक <b>{name}</b> · 📱 {phone} · PIN {pin} थप्ने। सेभ गरूँ?','ग्राहक <b>{name}</b> · 📱 {phone} · PIN {pin} जोड़ूँ। सेव करूँ?'),
  cfCredit:L('Add credit of <b>{amt}</b> for <b>{name}</b>{items}. Save?','<b>{name}</b> लाई <b>{amt}</b> उधारो{items} लेख्ने। सेभ गरूँ?','<b>{name}</b> के नाम <b>{amt}</b> उधार{items} लिखूँ। सेव करूँ?'),
  cfPayment:L('Record payment of <b>{amt}</b> from <b>{name}</b>. Save?','<b>{name}</b> बाट <b>{amt}</b> भुक्तानी लेख्ने। सेभ गरूँ?','<b>{name}</b> से <b>{amt}</b> भुगतान दर्ज करूँ। सेव करूँ?'),
  cfSale:L('Record sale of <b>{amt}</b> ({party}). Save?','<b>{amt}</b> को बिक्री ({party}) लेख्ने। सेभ गरूँ?','<b>{amt}</b> की बिक्री ({party}) दर्ज करूँ। सेव करूँ?'),
  doneCustomer:L('✅ Customer <b>{name}</b> added! They can login to the customer portal with 📱 {phone} + PIN.','✅ ग्राहक <b>{name}</b> थपियो! उहाँ 📱 {phone} + PIN ले ग्राहक पोर्टलमा लगइन गर्न सक्नुहुन्छ।','✅ ग्राहक <b>{name}</b> जुड़ गया! वे 📱 {phone} + PIN से ग्राहक पोर्टल में लॉगिन कर सकते हैं।'),
  doneCredit:L('✅ Credit saved! <b>{name}</b> now owes <b>{bal}</b>.','✅ उधारो लेखियो! अब <b>{name}</b> को बाँकी <b>{bal}</b> भयो।','✅ उधार लिख दिया! अब <b>{name}</b> का बकाया <b>{bal}</b> है।'),
  donePayment:L('✅ Payment of <b>{amt}</b> recorded. <b>{name}</b> now owes <b>{bal}</b>.','✅ <b>{amt}</b> भुक्तानी लेखियो। अब <b>{name}</b> को बाँकी <b>{bal}</b>।','✅ <b>{amt}</b> भुगतान दर्ज। अब <b>{name}</b> का बकाया <b>{bal}</b>।'),
  overPaid:L('(Note: {extra} was more than the dues, so only the due part was applied.)','(नोट: {extra} बाँकीभन्दा बढी थियो, बाँकी जति मात्र मिलान भयो।)','(नोट: {extra} बकाया से ज़्यादा था, केवल बकाया जितना ही लगा।)'),
  doneSale:L('✅ Sale of <b>{amt}</b> recorded for {party}.','✅ {party} को <b>{amt}</b> बिक्री लेखियो।','✅ {party} की <b>{amt}</b> बिक्री दर्ज हो गई।'),
  helpDash:L('Here is what I can do 👇<br>• <b>"Today\'s sales"</b> — daily summary<br>• <b>"Total dues"</b> / <b>"Top dues"</b><br>• <b>"Balance of Ram"</b> — any customer<br>• <b>"Add customer"</b>, <b>"Add credit"</b>, <b>"Record payment"</b>, <b>"Add sale"</b><br>• <b>"Open reports"</b> (any page)<br>• <b>"Backup"</b>, <b>"Export CSV"</b>, <b>"Sync"</b>, <b>"Dark/Light theme"</b><br>• <b>"Send reminder"</b> — WhatsApp dues reminder<br>• <b>"Pending requests"</b>, <b>"Cheques"</b>, <b>"This month"</b><br>🗣 Talk to me in English, नेपाली or हिंदी — typed or spoken!',
    'म यी काम गर्न सक्छु 👇<br>• <b>"आजको बिक्री"</b> — दैनिक हिसाब<br>• <b>"जम्मा उधारो"</b> / <b>"धेरै उधारो"</b><br>• <b>"राम को बाँकी"</b> — जुनसुकै ग्राहक<br>• <b>"नयाँ ग्राहक"</b>, <b>"उधारो थप्ने"</b>, <b>"भुक्तानी लेख्ने"</b>, <b>"बिक्री थप्ने"</b><br>• <b>"रिपोर्ट खोल"</b> (जुनसुकै पेज)<br>• <b>"ब्याकअप"</b>, <b>"CSV"</b>, <b>"सिंक"</b>, <b>"डार्क/लाइट थिम"</b><br>• <b>"रिमाइन्डर पठाऊ"</b> — WhatsApp<br>• <b>"पेन्डिङ रिपोर्ट"</b>, <b>"चेक"</b>, <b>"यो महिना"</b><br>🗣 नेपाली, हिंदी वा English — लेखेर वा बोलेर!',
    'मैं ये काम कर सकता हूँ 👇<br>• <b>"आज की बिक्री"</b> — दैनिक हिसाब<br>• <b>"कुल उधार"</b> / <b>"सबसे ज़्यादा उधार"</b><br>• <b>"राम का बकाया"</b> — कोई भी ग्राहक<br>• <b>"नया ग्राहक"</b>, <b>"उधार जोड़ें"</b>, <b>"भुगतान दर्ज"</b>, <b>"बिक्री जोड़ें"</b><br>• <b>"रिपोर्ट खोलो"</b> (कोई भी पेज)<br>• <b>"बैकअप"</b>, <b>"CSV"</b>, <b>"सिंक"</b>, <b>"डार्क/लाइट थीम"</b><br>• <b>"रिमाइंडर भेजो"</b> — WhatsApp<br>• <b>"पेंडिंग रिपोर्ट"</b>, <b>"चेक"</b>, <b>"इस महीने"</b><br>🗣 हिंदी, नेपाली या English — लिखकर या बोलकर!'),
  helpCust:L('I can help you with 👇<br>• <b>"My balance"</b> — how much you owe<br>• <b>"My dues"</b> — credit list<br>• <b>"Payment QR"</b> — scan &amp; pay<br>• <b>"Change PIN"</b><br>• <b>"Logout"</b><br>🗣 English, नेपाली or हिंदी!','म यसमा मद्दत गर्छु 👇<br>• <b>"मेरो बाँकी"</b> — कति तिर्न बाँकी<br>• <b>"मेरो उधारो"</b> — सूची<br>• <b>"भुक्तानी QR"</b> — स्क्यान गरी तिर्ने<br>• <b>"PIN फेर्ने"</b><br>• <b>"लगआउट"</b><br>🗣 नेपाली, हिंदी वा English!','मैं इनमें मदद करता हूँ 👇<br>• <b>"मेरा बकाया"</b> — कितना देना है<br>• <b>"मेरा उधार"</b> — सूची<br>• <b>"भुगतान QR"</b> — स्कैन करके चुकाएँ<br>• <b>"PIN बदलें"</b><br>• <b>"लॉगआउट"</b><br>🗣 हिंदी, नेपाली या English!'),
  helpLogin:L('I can explain 👇<br>• <b>"How to login"</b> — admin &amp; customer<br>• <b>"What is RD MART"</b><br>• <b>"Forgot PIN"</b><br>🗣 English, नेपाली or हिंदी!','म यी बुझाउन सक्छु 👇<br>• <b>"लगइन कसरी गर्ने"</b> — एडमिन र ग्राहक<br>• <b>"RD MART के हो"</b><br>• <b>"PIN बिर्सें"</b><br>🗣 नेपाली, हिंदी वा English!','मैं ये समझा सकता हूँ 👇<br>• <b>"लॉगिन कैसे करें"</b> — एडमिन और ग्राहक<br>• <b>"RD MART क्या है"</b><br>• <b>"PIN भूल गया"</b><br>🗣 हिंदी, नेपाली या English!'),
  loginHelp:L('🔐 <b>Admin/Staff:</b> use the Admin tab with your email &amp; password.<br>👤 <b>Customer:</b> use the Customer tab with your 10-digit phone + 4-digit PIN (the store gives you the PIN).','🔐 <b>एडमिन/स्टाफ:</b> Admin ट्याबमा इमेल र पासवर्डले लगइन गर्नुहोस्।<br>👤 <b>ग्राहक:</b> Customer ट्याबमा १० अङ्कको फोन + ४ अङ्कको PIN (PIN पसलले दिन्छ)।','🔐 <b>एडमिन/स्टाफ:</b> Admin टैब में ईमेल और पासवर्ड से लॉगिन करें।<br>👤 <b>ग्राहक:</b> Customer टैब में 10 अंकों का फोन + 4 अंकों का PIN (PIN दुकान से मिलता है)।'),
  aboutApp:L('🏪 <b>RD MART</b> is a mart located in <b>Koteshwor, Kathmandu</b>. The store sells the best products at cheaper rates and provides the best customer experience. 🕖 It opens from <b>7 AM to 10 PM</b> every day.','🏪 <b>RD MART</b> काठमाडौँको <b>कोटेश्वर</b>मा रहेको मार्ट हो। यो पसलले सबैभन्दा राम्रा सामान सस्तो मूल्यमा बेच्छ र उत्कृष्ट ग्राहक अनुभव दिन्छ। 🕖 हरेक दिन <b>बिहान ७ बजेदेखि राति १० बजेसम्म</b> खुल्छ।','🏪 <b>RD MART</b> काठमांडू के <b>कोटेश्वर</b> में स्थित मार्ट है। यह दुकान सबसे अच्छे प्रोडक्ट सस्ते दाम में बेचती है और बेहतरीन ग्राहक अनुभव देती है। 🕖 रोज़ <b>सुबह 7 बजे से रात 10 बजे तक</b> खुली रहती है।'),
  storeHours:L('🕖 <b>RD MART</b> opens every day from <b>7 AM to 10 PM</b>. You are always welcome!','🕖 <b>RD MART</b> हरेक दिन <b>बिहान ७ बजेदेखि राति १० बजेसम्म</b> खुल्छ। सधैं स्वागत छ!','🕖 <b>RD MART</b> रोज़ <b>सुबह 7 बजे से रात 10 बजे तक</b> खुला रहता है। आपका हमेशा स्वागत है!'),
  storeLoc:L('📍 <b>RD MART</b> is located in <b>Koteshwor, Kathmandu</b>. Best products at cheaper rates, open 7 AM – 10 PM.','📍 <b>RD MART</b> काठमाडौँको <b>कोटेश्वर</b>मा छ। राम्रा सामान सस्तो मूल्यमा, बिहान ७ – राति १० बजेसम्म खुला।','📍 <b>RD MART</b> काठमांडू के <b>कोटेश्वर</b> में है। अच्छे प्रोडक्ट सस्ते दाम में, सुबह 7 – रात 10 बजे तक खुला।'),
  forgotPin:L('🔑 Please contact the store — the admin can set a new PIN for you.','🔑 पसलमा सम्पर्क गर्नुहोस् — एडमिनले नयाँ PIN राखिदिन सक्नुहुन्छ।','🔑 दुकान से संपर्क करें — एडमिन नया PIN सेट कर सकते हैं।'),
  custMyBal:L('🙏 {name} ji, your current balance is <b>{amt}</b>.','🙏 {name} ज्यू, तपाईंको हालको बाँकी <b>{amt}</b> छ।','🙏 {name} जी, आपका मौजूदा बकाया <b>{amt}</b> है।'),
  custClear:L('🎉 {name} ji, you have no dues. All clear!','🎉 {name} ज्यू, तपाईंको केही बाँकी छैन। सबै चुक्ता!','🎉 {name} जी, आपका कोई बकाया नहीं। सब चुकता!'),
  custDuesHead:L('🧾 Your credit entries:','🧾 तपाईंका उधारो विवरण:','🧾 आपकी उधार सूची:'),
  custQr:L('📲 Open the <b>Overview</b> tab — the store payment QR is there. Scan it with your banking app, then use "Report a payment" so the store can verify.','📲 <b>Overview</b> ट्याबमा पसलको भुक्तानी QR छ। बैंकिङ एपले स्क्यान गरी तिर्नुहोस्, अनि "Report a payment" बाट जानकारी पठाउनुहोस्।','📲 <b>Overview</b> टैब में दुकान का भुगतान QR है। बैंकिंग ऐप से स्कैन करके चुकाएँ, फिर "Report a payment" से सूचना भेजें।'),
  custPin:L('🔑 Open the <b>Profile</b> tab to change your PIN.','🔑 PIN फेर्न <b>Profile</b> ट्याब खोल्नुहोस्।','🔑 PIN बदलने के लिए <b>Profile</b> टैब खोलिए।'),
  waBody:L('Namaste {name} ji! Gentle reminder from {mart}: your pending credit is {amt}. Please pay at your convenience. Thank you! 🙏','नमस्ते {name} ज्यू! {mart} बाट सम्झना: तपाईंको उधारो {amt} बाँकी छ। कृपया मिलाएर तिरिदिनुहोला। धन्यवाद! 🙏','नमस्ते {name} जी! {mart} की ओर से याद: आपका उधार {amt} बाकी है। कृपया सुविधानुसार चुका दें। धन्यवाद! 🙏'),
  briefHead:L('📋 <b>Daily briefing</b> — {d}','📋 <b>दैनिक ब्रिफिङ</b> — {d}','📋 <b>दैनिक ब्रीफिंग</b> — {d}'),
  briefSales:L('Sales today','आजको बिक्री','आज की बिक्री'),
  briefDues:L('Outstanding dues','उधारो बाँकी','बकाया उधार'),
  briefReqs:L('Payment reports waiting','भुक्तानी रिपोर्ट पर्खाइमा','भुगतान रिपोर्ट प्रतीक्षा में'),
  briefOverdue:L('Customers overdue 7+ days','७+ दिन ढिला ग्राहक','7+ दिन लेट ग्राहक'),
  briefCheques:L('Cheques due within 7 days','७ दिनभित्रका चेक','7 दिन में आने वाले चेक'),
  briefClear:L('All clear — nothing needs attention right now. ✅','सबै ठिकठाक — अहिले केही हेर्नु पर्दैन। ✅','सब ठीक — अभी कुछ देखना नहीं है। ✅'),
  wkHead:L('📈 <b>Last 7 days</b> (vs previous 7):','📈 <b>पछिल्लो ७ दिन</b> (अघिल्लो ७ सँग तुलना):','📈 <b>पिछले 7 दिन</b> (पिछले 7 से तुलना):'),
  wkTotal:L('Daily sales total','दैनिक बिक्री जम्मा','दैनिक बिक्री कुल'),
  wkPrev:L('Previous 7 days','अघिल्लो ७ दिन','उससे पहले के 7 दिन'),
  wkBest:L('Best day','उत्कृष्ट दिन','सबसे अच्छा दिन'),
  wkCredit:L('Credit given','दिएको उधारो','दिया उधार'),
  wkUp:L('⬆ Up {p}% from last week — great going!','⬆ गत हप्ताभन्दा {p}% बढी — बधाई छ!','⬆ पिछले हफ्ते से {p}% ज़्यादा — बहुत बढ़िया!'),
  wkDown:L('⬇ Down {p}% from last week.','⬇ गत हप्ताभन्दा {p}% कम।','⬇ पिछले हफ्ते से {p}% कम।'),
  overdueHead:L('⏰ Overdue customers (oldest unpaid credit):','⏰ ढिला भएका ग्राहक (सबैभन्दा पुरानो नतिरेको उधारो):','⏰ लेट ग्राहक (सबसे पुराना बिना चुकाया उधार):'),
  overdueNone:L('✅ Nobody is overdue by 7+ days. Well managed!','✅ ७+ दिन ढिला कोही छैन। राम्रो व्यवस्थापन!','✅ 7+ दिन से लेट कोई नहीं। बढ़िया प्रबंधन!'),
  daysWord:L('{n} days','{n} दिन','{n} दिन'),
  profileHead:L('👤 <b>{name}</b>','👤 <b>{name}</b>','👤 <b>{name}</b>'),
  pfPhone:L('Phone','फोन','फोन'),
  pfEmail:L('Email','इमेल','ईमेल'),
  pfAddress:L('Address','ठेगाना','पता'),
  pfLimit:L('Credit limit','उधारो सीमा','उधार सीमा'),
  pfBalance:L('Balance due','बाँकी','बकाया'),
  pfSince:L('Customer since','ग्राहक बनेको','ग्राहक बने'),
  pfNoLimit:L('No limit','सीमा छैन','कोई सीमा नहीं'),
  statsHead:L('📊 <b>Store snapshot</b>:','📊 <b>पसलको झलक</b>:','📊 <b>दुकान की झलक</b>:'),
  stCustomers:L('Customers','ग्राहक','ग्राहक'),
  stWithDues:L('With pending dues','उधारो बाँकी भएका','बकाया वाले'),
  stCredits:L('Credit entries','उधारो प्रविष्टि','उधार प्रविष्टियाँ'),
  stCheques:L('Cheques on hold','होल्डमा चेक','होल्ड पर चेक'),
  chequeSoon:L('🏦 Cheques due within 7 days:','🏦 ७ दिनभित्र आउने चेक:','🏦 7 दिन में आने वाले चेक:'),
  chequeMarkDone:L('✅ Cheque <b>{no}</b> ({party}, {amt}) marked <b>{st}</b>.','✅ चेक <b>{no}</b> ({party}, {amt}) <b>{st}</b> भयो।','✅ चेक <b>{no}</b> ({party}, {amt}) <b>{st}</b> हो गया।'),
  chequeNotFound:L('😕 No cheque found with number "{no}".','😕 "{no}" नम्बरको चेक भेटिएन।','😕 "{no}" नंबर का चेक नहीं मिला।'),
  chequePickMark:L('Which cheque do you want to update? 👇','कुन चेक अपडेट गर्ने? 👇','कौन-सा चेक अपडेट करना है? 👇'),
  askParty2:L('🏢 Party name?','🏢 पार्टीको नाम?','🏢 पार्टी का नाम?'),
  askChequeNo:L('🔢 Cheque number?','🔢 चेक नम्बर?','🔢 चेक नंबर?'),
  askBank:L('🏦 Bank name? (or type <i>skip</i>)','🏦 बैंकको नाम? (नभए <i>skip</i>)','🏦 बैंक का नाम? (नहीं तो <i>skip</i>)'),
  askDaily:L('💵 Tell me the amounts in one line, e.g.:<br><b>cash 5000 pos 2000 fonepay 1500</b><br>(cash / pos / fonepay / finance / party / other)','💵 एकै लाइनमा रकम भन्नुहोस्, जस्तै:<br><b>नगद 5000 पोस 2000 फोनपे 1500</b><br>(नगद / पोस / फोनपे / फाइनान्स / पार्टी / अन्य)','💵 एक ही लाइन में रकम बताइए, जैसे:<br><b>नकद 5000 पोस 2000 फोनपे 1500</b><br>(नकद / पोस / फोनपे / फाइनेंस / पार्टी / अन्य)'),
  badDaily:L('⚠️ I could not read any amounts. Try like: <b>cash 5000 pos 2000</b>','⚠️ रकम बुझिनँ। यसरी भन्नुहोस्: <b>नगद 5000 पोस 2000</b>','⚠️ रकम समझ नहीं आई। ऐसे बताइए: <b>नकद 5000 पोस 2000</b>'),
  askMethod:L('💳 Paid via? (eSewa / Khalti / FonePay / Bank / Cash)','💳 केबाट तिर्नुभयो? (eSewa / Khalti / FonePay / Bank / Cash)','💳 किससे चुकाया? (eSewa / Khalti / FonePay / Bank / Cash)'),
  askReference:L('🧾 Transaction ID / note? (or type <i>skip</i>)','🧾 ट्रान्ज्याक्सन ID / नोट? (नभए <i>skip</i>)','🧾 ट्रांज़ैक्शन ID / नोट? (नहीं तो <i>skip</i>)'),
  cfCheque:L('Add cheque <b>{no}</b> · {party} · <b>{amt}</b>{bank}. Save?','चेक <b>{no}</b> · {party} · <b>{amt}</b>{bank} थप्ने। सेभ गरूँ?','चेक <b>{no}</b> · {party} · <b>{amt}</b>{bank} जोड़ूँ। सेव करूँ?'),
  doneCheque:L('✅ Cheque <b>{no}</b> for <b>{amt}</b> saved (status: hold).','✅ चेक <b>{no}</b>, <b>{amt}</b> सेभ भयो (स्थिति: होल्ड)।','✅ चेक <b>{no}</b>, <b>{amt}</b> सेव हो गया (स्थिति: होल्ड)।'),
  cfEstimate:L('Create estimate of <b>{amt}</b> for <b>{party}</b>{items}. Save?','<b>{party}</b> का लागि <b>{amt}</b> को इस्टिमेट{items} बनाउने। सेभ गरूँ?','<b>{party}</b> के लिए <b>{amt}</b> का एस्टीमेट{items} बनाऊँ। सेव करूँ?'),
  doneEstimate:L('✅ Estimate bill of <b>{amt}</b> created for {party} (status: draft).','✅ {party} को <b>{amt}</b> इस्टिमेट बन्यो (स्थिति: draft)।','✅ {party} का <b>{amt}</b> एस्टीमेट बन गया (स्थिति: draft)।'),
  cfDaily:L('Save today\'s daily sales — total <b>{amt}</b>?<br>{rows}','आजको दैनिक बिक्री सेभ गर्ने — जम्मा <b>{amt}</b>?<br>{rows}','आज की दैनिक बिक्री सेव करूँ — कुल <b>{amt}</b>?<br>{rows}'),
  doneDaily:L('✅ Daily sales saved! Total <b>{amt}</b> for {d}.','✅ दैनिक बिक्री सेभ भयो! {d} को जम्मा <b>{amt}</b>।','✅ दैनिक बिक्री सेव हो गई! {d} का कुल <b>{amt}</b>।'),
  cfLimit:L('Set credit limit of <b>{amt}</b> for <b>{name}</b>?','<b>{name}</b> को उधारो सीमा <b>{amt}</b> राख्ने?','<b>{name}</b> की उधार सीमा <b>{amt}</b> रखूँ?'),
  doneLimit:L('✅ Credit limit for <b>{name}</b> is now <b>{amt}</b>.','✅ <b>{name}</b> को उधारो सीमा अब <b>{amt}</b> भयो।','✅ <b>{name}</b> की उधार सीमा अब <b>{amt}</b> है।'),
  calcAns:L('🧮 <b>{expr}</b> = <b>{ans}</b>','🧮 <b>{expr}</b> = <b>{ans}</b>','🧮 <b>{expr}</b> = <b>{ans}</b>'),
  pickStore:L('🏪 Which store do you want to switch to?','🏪 कुन पसलमा जाने?','🏪 किस दुकान पर जाना है?'),
  storeSet:L('🏪 Switched to <b>{name}</b>. Data reloaded.','🏪 <b>{name}</b> मा गइयो। डाटा रिलोड भयो।','🏪 <b>{name}</b> पर आ गए। डेटा रीलोड हो गया।'),
  oneStore:L('You only have one store right now. Add stores in Settings → Stores.','अहिले एउटै पसल छ। Settings → Stores बाट थप्न सकिन्छ।','अभी एक ही दुकान है। Settings → Stores से जोड़ सकते हैं।'),
  lastBackupAt:L('💾 Last backup: <b>{d}</b>. Regular backups keep your data safe!','💾 अन्तिम ब्याकअप: <b>{d}</b>। नियमित ब्याकअपले डाटा सुरक्षित राख्छ!','💾 आखिरी बैकअप: <b>{d}</b>। नियमित बैकअप से डेटा सुरक्षित रहता है!'),
  lastBackupNever:L('💾 No backup has been taken yet on this device. Shall I download one?','💾 यो डिभाइसमा अहिलेसम्म ब्याकअप लिइएको छैन। अहिले लिऊँ?','💾 इस डिवाइस पर अभी तक बैकअप नहीं लिया गया। अभी लूँ?'),
  reqListHead:L('🔔 Pending payment reports:','🔔 पेन्डिङ भुक्तानी रिपोर्ट:','🔔 पेंडिंग भुगतान रिपोर्ट:'),
  reqApproved:L('✅ Approved — {amt} from {name} applied to their dues.','✅ स्वीकृत — {name} को {amt} उधारोमा मिलान भयो।','✅ मंज़ूर — {name} का {amt} बकाये में लग गया।'),
  reqRejected:L('❌ Rejected the report of {amt} from {name}.','❌ {name} को {amt} रिपोर्ट अस्वीकृत भयो।','❌ {name} की {amt} रिपोर्ट अस्वीकार की।'),
  stmtOpen:L('📄 Opening statement of <b>{name}</b>…','📄 <b>{name}</b> को स्टेटमेन्ट खोल्दैछु…','📄 <b>{name}</b> का स्टेटमेंट खोल रहा हूँ…'),
  menuHead:L('🗂 <b>Everything I can do</b> — tap any:','🗂 <b>म गर्न सक्ने सबै काम</b> — जुनसुकै थिच्नुहोस्:','🗂 <b>मैं जो-जो कर सकता हूँ</b> — कोई भी दबाइए:'),
  custPayDone:L('✅ Payment report of <b>{amt}</b> sent! The store will confirm it soon.','✅ <b>{amt}</b> को भुक्तानी रिपोर्ट पठाइयो! पसलले चाँडै पक्का गर्नेछ।','✅ <b>{amt}</b> की भुगतान रिपोर्ट भेज दी! दुकान जल्द पक्का करेगी।'),
  custPayNeedOnline:L('Payment reports need the online database. Please use the form in the Overview tab.','भुक्तानी रिपोर्टका लागि अनलाइन डाटाबेस चाहिन्छ। Overview ट्याबको फारम प्रयोग गर्नुहोस्।','भुगतान रिपोर्ट के लिए ऑनलाइन डेटाबेस चाहिए। Overview टैब का फ़ॉर्म इस्तेमाल करें।'),
  cfCustPay:L('Send payment report: <b>{amt}</b> via {method}{ref}?','भुक्तानी रिपोर्ट पठाउने: <b>{amt}</b>, {method}{ref}?','भुगतान रिपोर्ट भेजूँ: <b>{amt}</b>, {method}{ref}?'),
  goodMorning:L('Good morning','शुभ प्रभात','सुप्रभात'),
  goodAfternoon:L('Good afternoon','नमस्कार','नमस्कार'),
  goodEvening:L('Good evening','शुभ सन्ध्या','शुभ संध्या')
};
const PAGE_LABEL={dashboard:L('Dashboard','ड्यासबोर्ड','डैशबोर्ड'),customers:L('Customers','ग्राहक','ग्राहक'),credits:L('Credit Book','उधारो खाता','उधार खाता'),daily:L('Daily Sales','दैनिक बिक्री','दैनिक बिक्री'),payments:L('Party Payments','पार्टी भुक्तानी','पार्टी भुगतान'),cheques:L('Cheques','चेक','चेक'),estimates:L('Estimates','इस्टिमेट','एस्टीमेट'),reports:L('Reports','रिपोर्ट','रिपोर्ट'),followup:L('Follow-Up','फलो-अप','फॉलो-अप'),settings:L('Settings','सेटिङ','सेटिंग')};
const CHIPS={
  dash:[
    {t:L('📋 Briefing','📋 ब्रिफिङ','📋 ब्रीफिंग')},
    {t:L("📊 Today's sales",'📊 आजको बिक्री','📊 आज की बिक्री')},
    {t:L('💰 Total dues','💰 जम्मा उधारो','💰 कुल उधार')},
    {t:L('🏆 Top dues','🏆 धेरै उधारो','🏆 सबसे ज़्यादा उधार')},
    {t:L('🧾 Add credit','🧾 उधारो थप्ने','🧾 उधार जोड़ें')},
    {t:L('✅ Record payment','✅ भुक्तानी लेख्ने','✅ भुगतान दर्ज करें')},
    {t:L('👤 Add customer','👤 नयाँ ग्राहक','👤 नया ग्राहक')},
    {t:L('🗂 Menu','🗂 मेनु','🗂 मेन्यू')},
    {t:L('❓ Help','❓ मद्दत','❓ मदद')}
  ],
  cust:[
    {t:L('💰 My balance','💰 मेरो बाँकी','💰 मेरा बकाया')},
    {t:L('🧾 My dues','🧾 मेरो उधारो','🧾 मेरा उधार')},
    {t:L('📲 Payment QR','📲 भुक्तानी QR','📲 भुगतान QR')},
    {t:L('🔑 Change PIN','🔑 PIN फेर्ने','🔑 PIN बदलें')},
    {t:L('❓ Help','❓ मद्दत','❓ मदद')}
  ],
  login:[
    {t:L('🔐 How to login?','🔐 लगइन कसरी?','🔐 लॉगिन कैसे?')},
    {t:L('🏪 What is RD MART?','🏪 RD MART के हो?','🏪 RD MART क्या है?')},
    {t:L('❓ Help','❓ मद्दत','❓ मदद')}
  ]
};
const t=k=>(T[k]||L('','',''))[lang]||T[k].en;
const fmt=(s,o)=>s.replace(/\{(\w+)\}/g,(_,k)=>o[k]??'');

/* ---------- css ---------- */
const CSS=`
.mbot-fab{position:fixed;right:18px;bottom:18px;z-index:1200;width:66px;height:66px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,#7c3aed,#06b6d4);box-shadow:0 16px 42px rgba(124,58,237,.5);padding:6px;animation:mbotBob 3.4s ease-in-out infinite;transition:transform .2s}
.mbot-fab:hover{transform:scale(1.08)}
.mbot-fab svg{width:100%;height:100%;display:block}
@keyframes mbotBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
.mbot-bubble{position:fixed;right:94px;bottom:36px;z-index:1200;background:#fff;color:#0f172a;font-weight:800;font-size:13px;padding:9px 13px;border-radius:16px 16px 4px 16px;box-shadow:0 12px 32px rgba(0,0,0,.28);opacity:0;pointer-events:none;transform:translateY(8px);transition:.3s;max-width:230px}
.mbot-bubble.on{opacity:1;transform:none}
.mbot-panel{position:fixed;right:18px;bottom:96px;z-index:1201;width:min(394px,calc(100vw - 24px));height:min(600px,calc(100vh - 128px));display:none;flex-direction:column;border-radius:24px;overflow:hidden;border:1px solid rgba(255,255,255,.16);background:linear-gradient(165deg,rgba(15,27,45,.97),rgba(7,17,31,.98));box-shadow:0 30px 90px rgba(0,0,0,.5);backdrop-filter:blur(20px)}
.mbot-panel.open{display:flex;animation:mbotIn .3s cubic-bezier(.2,.9,.3,1.15) both}
@keyframes mbotIn{from{opacity:0;transform:translateY(26px) scale(.94)}to{opacity:1;transform:none}}
.mbot-head{display:flex;align-items:center;gap:10px;padding:12px 14px;background:linear-gradient(135deg,rgba(124,58,237,.38),rgba(6,182,212,.26));border-bottom:1px solid rgba(255,255,255,.12);flex:none}
.mbot-hava{width:46px;height:46px;flex:none;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#06b6d4);padding:3px;box-shadow:0 8px 20px rgba(0,0,0,.25)}
.mbot-hava svg{width:100%;height:100%;display:block}
.mbot-hmeta{flex:1;min-width:0}
.mbot-hname{font-weight:950;font-size:15px;color:#fff;letter-spacing:-.3px}
.mbot-hsub{font-size:10.5px;color:#a5f3fc;font-weight:800;display:flex;align-items:center;gap:5px;margin-top:2px}
.mbot-dot{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.2);flex:none}
.mbot-hbtn{width:32px;height:32px;flex:none;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.1);color:#fff;cursor:pointer;font-size:14px;display:grid;place-items:center;transition:.15s}
.mbot-hbtn:hover{background:rgba(255,255,255,.22)}
.mbot-hbtn.off{opacity:.4}
.mbot-lang{height:32px;flex:none;border:1px solid rgba(255,255,255,.16);background:rgba(3,7,18,.5);color:#fff;border-radius:10px;font-size:11.5px;font-weight:900;padding:0 6px;cursor:pointer;outline:none}
.mbot-lang option{color:#0f172a;background:#fff}
.mbot-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
.mbot-msgs::-webkit-scrollbar{width:7px}
.mbot-msgs::-webkit-scrollbar-thumb{background:rgba(148,163,184,.35);border-radius:999px}
.mbot-row{display:flex;gap:8px;align-items:flex-end}
.mbot-row.me{justify-content:flex-end}
.mbot-mava{width:28px;height:28px;flex:none;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#06b6d4);padding:2px}
.mbot-mava svg{width:100%;height:100%;display:block}
.mbot-msg{max-width:84%;padding:10px 13px;border-radius:16px;font-size:13.5px;line-height:1.7;color:#eaf2ff;word-break:break-word}
.mbot-row.bot .mbot-msg{background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.1);border-bottom-left-radius:5px}
.mbot-row.me .mbot-msg{background:linear-gradient(135deg,#7c3aed,#06b6d4);color:#fff;border-bottom-right-radius:5px;font-weight:700}
.mbot-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}
.mbot-act{border:1px solid rgba(6,182,212,.5);background:rgba(6,182,212,.13);color:#a5f3fc;font-size:12px;font-weight:900;border-radius:999px;padding:6px 12px;cursor:pointer;transition:.15s;font-family:inherit}
.mbot-act:hover{background:rgba(6,182,212,.32);color:#fff}
.mbot-lrow{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px dashed rgba(255,255,255,.12);font-size:12.5px}
.mbot-lrow:last-child{border-bottom:none}
.mbot-lrow b{color:#fff}
.mbot-typing{display:inline-flex;gap:4px;padding:5px 2px}
.mbot-typing span{width:7px;height:7px;border-radius:50%;background:#7dd3fc;animation:mbotTyp 1s infinite}
.mbot-typing span:nth-child(2){animation-delay:.15s}
.mbot-typing span:nth-child(3){animation-delay:.3s}
@keyframes mbotTyp{0%,100%{opacity:.3;transform:translateY(0)}50%{opacity:1;transform:translateY(-4px)}}
.mbot-chips{flex:none;display:flex;gap:7px;overflow-x:auto;padding:9px 12px;border-top:1px solid rgba(255,255,255,.1);scrollbar-width:none}
.mbot-chips::-webkit-scrollbar{display:none}
.mbot-chip{flex:none;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);color:#dce8f8;font-size:12px;font-weight:900;border-radius:999px;padding:8px 13px;cursor:pointer;transition:.15s;font-family:inherit}
.mbot-chip:hover{background:linear-gradient(135deg,#7c3aed,#06b6d4);color:#fff;border-color:transparent}
.mbot-inrow{flex:none;display:flex;gap:8px;padding:10px 12px 12px;border-top:1px solid rgba(255,255,255,.1);background:rgba(3,7,18,.42)}
.mbot-in{flex:1;min-width:0;border:1px solid rgba(255,255,255,.16);background:rgba(3,7,18,.55);color:#fff;border-radius:14px;padding:11px 13px;outline:none;font-size:13.5px;font-family:inherit}
.mbot-in:focus{border-color:rgba(6,182,212,.7);box-shadow:0 0 0 3px rgba(6,182,212,.14)}
.mbot-in::placeholder{color:#64748b}
.mbot-mic,.mbot-send{width:42px;height:42px;flex:none;border-radius:13px;border:none;cursor:pointer;display:grid;place-items:center;font-size:16px;transition:.15s}
.mbot-mic{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16);color:#fff}
.mbot-mic.rec{background:#ef4444;border-color:transparent;animation:mbotPulse 1s infinite}
@keyframes mbotPulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.5)}50%{box-shadow:0 0 0 10px rgba(239,68,68,0)}}
.mbot-send{background:linear-gradient(135deg,#7c3aed,#06b6d4);color:#fff}
.mbot-send:hover{transform:translateY(-1px)}
.mbot-eye{transform-origin:center;transform-box:fill-box;animation:mbotBlink 4.6s infinite}
@keyframes mbotBlink{0%,90%,100%{transform:scaleY(1)}94%{transform:scaleY(.08)}}
.mbot-mouth{transform-origin:center;transform-box:fill-box}
.mbot-talk .mbot-mouth{animation:mbotTalk .22s infinite alternate}
@keyframes mbotTalk{from{transform:scaleY(.45)}to{transform:scaleY(1.3)}}
body[data-theme="light"] .mbot-panel{background:linear-gradient(165deg,rgba(255,255,255,.99),rgba(241,245,249,.97));border-color:rgba(15,23,42,.12);box-shadow:0 30px 90px rgba(15,23,42,.22)}
body[data-theme="light"] .mbot-head{background:linear-gradient(135deg,rgba(124,58,237,.14),rgba(6,182,212,.1));border-bottom-color:rgba(15,23,42,.1)}
body[data-theme="light"] .mbot-hname{color:#0f172a}
body[data-theme="light"] .mbot-hsub{color:#0369a1}
body[data-theme="light"] .mbot-hbtn{background:rgba(15,23,42,.06);border-color:rgba(15,23,42,.14);color:#0f172a}
body[data-theme="light"] .mbot-lang{background:#fff;color:#0f172a;border-color:rgba(15,23,42,.14)}
body[data-theme="light"] .mbot-msg{color:#0f172a}
body[data-theme="light"] .mbot-row.bot .mbot-msg{background:rgba(15,23,42,.05);border-color:rgba(15,23,42,.1)}
body[data-theme="light"] .mbot-row.me .mbot-msg{color:#fff}
body[data-theme="light"] .mbot-lrow{border-bottom-color:rgba(15,23,42,.14)}
body[data-theme="light"] .mbot-lrow b{color:#0f172a}
body[data-theme="light"] .mbot-chips,body[data-theme="light"] .mbot-inrow{border-top-color:rgba(15,23,42,.1)}
body[data-theme="light"] .mbot-inrow{background:rgba(15,23,42,.03)}
body[data-theme="light"] .mbot-chip{background:rgba(15,23,42,.05);border-color:rgba(15,23,42,.14);color:#334155}
body[data-theme="light"] .mbot-in{background:#fff;color:#0f172a;border-color:rgba(15,23,42,.16)}
body[data-theme="light"] .mbot-mic{background:rgba(15,23,42,.06);border-color:rgba(15,23,42,.14);color:#0f172a}
body[data-theme="light"] .mbot-act{background:rgba(2,132,199,.08);border-color:rgba(2,132,199,.35);color:#0369a1}
body[data-theme="light"] .mbot-act:hover{background:rgba(2,132,199,.2);color:#0c4a6e}
@media(max-width:480px){.mbot-panel{right:12px;left:12px;width:auto;bottom:90px;height:min(560px,calc(100vh - 108px))}.mbot-fab{right:14px;bottom:14px}.mbot-bubble{right:88px;bottom:30px}}
@media print{.mbot-fab,.mbot-panel,.mbot-bubble{display:none!important}}
`;

/* ---------- cartoon character svg ---------- */
function charSVG(cls){return `<svg class="${cls||''}" viewBox="0 0 120 120" aria-hidden="true">
<defs><linearGradient id="mbg-${cls||'x'}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c4b5fd"/><stop offset="1" stop-color="#67e8f9"/></linearGradient></defs>
<line x1="60" y1="13" x2="60" y2="26" stroke="#e0f2fe" stroke-width="4.5" stroke-linecap="round"/>
<circle cx="60" cy="10" r="6" fill="#fbbf24"><animate attributeName="opacity" values="1;.4;1" dur="1.7s" repeatCount="indefinite"/></circle>
<rect x="6" y="52" width="11" height="24" rx="5.5" fill="#a5b4fc"/>
<rect x="103" y="52" width="11" height="24" rx="5.5" fill="#a5b4fc"/>
<rect x="15" y="24" width="90" height="82" rx="36" fill="url(#mbg-${cls||'x'})"/>
<rect x="26" y="39" width="68" height="53" rx="24" fill="#0b1526"/>
<g class="mbot-eye"><circle cx="46" cy="61" r="8.5" fill="#67e8f9"/><circle cx="49" cy="58" r="2.8" fill="#fff"/></g>
<g class="mbot-eye"><circle cx="74" cy="61" r="8.5" fill="#67e8f9"/><circle cx="77" cy="58" r="2.8" fill="#fff"/></g>
<circle cx="35" cy="74" r="4" fill="#f472b6" opacity=".55"/>
<circle cx="85" cy="74" r="4" fill="#f472b6" opacity=".55"/>
<path class="mbot-mouth" d="M49 77 Q60 87 71 77" stroke="#67e8f9" stroke-width="4.5" fill="none" stroke-linecap="round"/>
</svg>`}

/* ---------- build DOM ---------- */
const style=document.createElement('style');style.id='mbot-css';style.textContent=CSS;document.head.appendChild(style);
const fab=document.createElement('button');fab.className='mbot-fab';fab.type='button';fab.setAttribute('aria-label','Open Saathi assistant');fab.innerHTML=charSVG('fab');
const bubble=document.createElement('div');bubble.className='mbot-bubble';
const panel=document.createElement('div');panel.className='mbot-panel';
panel.innerHTML=`
  <div class="mbot-head">
    <div class="mbot-hava">${charSVG('hava')}</div>
    <div class="mbot-hmeta">
      <div class="mbot-hname" id="mbotName"></div>
      <div class="mbot-hsub"><span class="mbot-dot"></span><span id="mbotSub"></span></div>
    </div>
    <select class="mbot-lang" id="mbotLang" title="Language">
      <option value="en">EN</option><option value="ne">नेपाली</option><option value="hi">हिंदी</option>
    </select>
    <button class="mbot-hbtn" id="mbotVoice" type="button" title="Voice on/off">🔊</button>
    <button class="mbot-hbtn" id="mbotClose" type="button" title="Close">✕</button>
  </div>
  <div class="mbot-msgs" id="mbotMsgs"></div>
  <div class="mbot-chips" id="mbotChips"></div>
  <div class="mbot-inrow">
    <button class="mbot-mic" id="mbotMic" type="button" title="Speak">🎤</button>
    <input class="mbot-in" id="mbotIn" autocomplete="off" spellcheck="false">
    <button class="mbot-send" id="mbotSend" type="button" title="Send">➤</button>
  </div>`;
document.body.appendChild(fab);document.body.appendChild(bubble);document.body.appendChild(panel);
const $m=id=>panel.querySelector('#'+id);
const msgsEl=$m('mbotMsgs'),inEl=$m('mbotIn'),micBtn=$m('mbotMic'),chipsEl=$m('mbotChips'),voiceBtn=$m('mbotVoice'),langSel=$m('mbotLang');

function applyLangUI(){
  $m('mbotName').textContent=UI.name[lang];
  $m('mbotSub').textContent=UI.sub[lang];
  inEl.placeholder=UI.ph[lang];
  langSel.value=lang;
  voiceBtn.textContent=voiceOn?'🔊':'🔇';
  voiceBtn.classList.toggle('off',!voiceOn);
  chipsEl.innerHTML=CHIPS[MODE].map(c=>`<button class="mbot-chip" type="button" data-mba="send:${esc(c.t[lang])}">${esc(c.t[lang])}</button>`).join('');
}

/* ---------- messages ---------- */
function scrollDown(){msgsEl.scrollTop=msgsEl.scrollHeight}
function addUser(text){
  const row=document.createElement('div');row.className='mbot-row me';
  row.innerHTML=`<div class="mbot-msg">${esc(text)}</div>`;
  msgsEl.appendChild(row);scrollDown();
}
function botSay(html,opts){
  opts=opts||{};
  const row=document.createElement('div');row.className='mbot-row bot';
  row.innerHTML=`<div class="mbot-mava">${charSVG('m'+Date.now()%1000)}</div><div class="mbot-msg">${html}${opts.acts?`<div class="mbot-acts">${opts.acts}</div>`:''}</div>`;
  msgsEl.appendChild(row);scrollDown();
  speak(opts.speak!==undefined?opts.speak:html);
}
function act(label,action){return `<button class="mbot-act" type="button" data-mba="${esc(action)}">${label}</button>`}
let typingEl=null;
function showTyping(){typingEl=document.createElement('div');typingEl.className='mbot-row bot';typingEl.innerHTML=`<div class="mbot-mava">${charSVG('t')}</div><div class="mbot-msg"><span class="mbot-typing"><span></span><span></span><span></span></span></div>`;msgsEl.appendChild(typingEl);scrollDown()}
function hideTyping(){if(typingEl){typingEl.remove();typingEl=null}}

/* ---------- speech: TTS ---------- */
let voices=[];
function loadVoices(){try{voices=speechSynthesis.getVoices()||[]}catch(e){voices=[]}}
if('speechSynthesis' in window){loadVoices();speechSynthesis.onvoiceschanged=loadVoices}
/* Prefer a clear, natural FEMALE voice for each language.
   Named voices: Windows (Neerja, Heera, Swara, Kalpana, Zira, Aria, Jenny),
   Google (female by default), macOS/iOS (Samantha, Veena, Lekha, Isha). */
const FEMALE_NAMES=['female','woman','girl','neerja','heera','swara','kalpana','zira','aria','jenny','michelle','sonia','libby','maisie','natasha','samantha','veena','lekha','isha','ananya','aarohi','kavya','salli','raveena','aditi','kajal','susan','hazel','sara','emma','ava'];
const MALE_NAMES=[' male','man ','david','mark','ravi','hemant','prabhat','madhur','george','james','guy','ryan','thomas','rishi','sagar'];
/* Sweetest-sounding female voices, ranked above the rest */
const SWEET_NAMES=['swara','ananya','aarohi','jenny','aria','sonia','libby','natasha','emma','ava','samantha','neerja'];
function scoreVoice(v,prefLangs){
  const name=String(v.name||'').toLowerCase(),vlang=String(v.lang||'').toLowerCase().replace('_','-');
  const li=prefLangs.findIndex(p=>vlang.startsWith(p));
  if(li<0)return -1;
  let s=(prefLangs.length-li)*100;
  /* Google voices are female by default even when the name doesn't say so */
  if(FEMALE_NAMES.some(h=>name.includes(h))||(name.includes('google')&&!name.includes(' male')))s+=60;
  if(MALE_NAMES.some(h=>name.includes(h)))s-=80;
  /* Neural "Natural/Online" voices (Edge: Swara, Neerja, Aria, Jenny…) sound far
     softer and sweeter than the robotic desktop ones — weight them heavily */
  if(/natural|neural|online/.test(name))s+=90;
  if(name.includes('google'))s+=40;
  if(SWEET_NAMES.some(h=>name.includes(h)))s+=25;
  return s;
}
function pickVoice(){
  /* Nepali TTS voices barely exist in browsers, so for नेपाली we fall back to a
     female Hindi voice — it reads Devanagari clearly instead of a robotic default. */
  const pref={en:['en-in','en-gb','en-us','en'],ne:['ne-np','ne','hi-in','hi','en-in'],hi:['hi-in','hi','en-in']}[lang];
  let best=null,bestScore=-1;
  voices.forEach(v=>{const s=scoreVoice(v,pref);if(s>bestScore){best=v;bestScore=s}});
  return best;
}
function talkFace(on){[fab,panel.querySelector('.mbot-hava')].forEach(el=>{if(el)el.classList.toggle('mbot-talk',on)})}
let resumeTimer=null;
function speak(html){
  if(!voiceOn||!('speechSynthesis' in window)||html===null||html==='')return;
  try{
    const tmp=document.createElement('div');tmp.innerHTML=String(html).replace(/<br\s*\/?>/gi,'. ');
    let s=(tmp.textContent||'').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu,'').replace(/\s+/g,' ').trim();
    s=s.replace(/Rs\s?/g,lang==='en'?'rupees ':lang==='ne'?'रुपैयाँ ':'रुपये ');
    s=s.replace(/\s*[·|]\s*/g,', ');
    if(s.length>600)s=s.slice(0,600);
    if(!s)return;
    speechSynthesis.cancel();clearInterval(resumeTimer);
    /* Speak sentence-by-sentence: long single utterances get cut off or slurred,
       short chunks stay crisp and add natural pauses. */
    const sentences=s.match(/[^.!?।]+[.!?।]?/g)||[s];
    const parts=[];let buf='';
    sentences.forEach(c=>{if(buf&&(buf+c).length>170){parts.push(buf);buf=c}else buf+=c});
    if(buf.trim())parts.push(buf);
    const v=pickVoice();
    talkFace(true);
    parts.forEach((p,i)=>{
      const u=new SpeechSynthesisUtterance(p.trim());
      if(v){u.voice=v;u.lang=v.lang}
      else u.lang={en:'en-IN',ne:'hi-IN',hi:'hi-IN'}[lang];
      /* Sweet tone: neural voices already sound warm — keep them near natural.
         Robotic desktop voices get a higher pitch + slower pace to soften them. */
      const natural=v&&/natural|neural|online|google/i.test(v.name||'');
      u.rate=natural?0.97:0.92;u.pitch=natural?1.1:1.28;u.volume=1;
      if(i===parts.length-1){
        u.onend=()=>{talkFace(false);clearInterval(resumeTimer)};
        u.onerror=()=>{talkFace(false);clearInterval(resumeTimer)};
      }
      speechSynthesis.speak(u);
    });
    /* Chrome silently pauses speech after ~15s — keep nudging it awake */
    resumeTimer=setInterval(()=>{
      if(!speechSynthesis.speaking){clearInterval(resumeTimer);talkFace(false)}
      else speechSynthesis.resume();
    },4000);
  }catch(e){}
}

/* ---------- speech: mic ---------- */
function startListen(){
  if(listening){try{recog.stop()}catch(e){}return}
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){botSay(t('noMic'));return}
  try{
    recog=new SR();
    recog.lang={en:'en-IN',ne:'ne-NP',hi:'hi-IN'}[lang];
    recog.interimResults=false;recog.maxAlternatives=1;
    recog.onresult=e=>{const s=e.results[0][0].transcript;inEl.value=s;sendMsg()};
    recog.onerror=e=>{listening=false;micBtn.classList.remove('rec');if(e.error!=='aborted'&&e.error!=='no-speech')botSay(t('micErr'))};
    recog.onend=()=>{listening=false;micBtn.classList.remove('rec')};
    recog.start();listening=true;micBtn.classList.add('rec');
  }catch(e){botSay(t('noMic'))}
}

/* ---------- text utils ---------- */
function digitsAscii(s){return String(s||'').replace(/[०-९]/g,d=>'०१२३४५६७८९'.indexOf(d))}
function norm(s){return digitsAscii(s).toLowerCase().replace(/[?!।,.:;'"“”()\[\]]/g,' ').replace(/\s+/g,' ').trim()}
function has(text,words){return words.some(w=>text.includes(w))}
function findPhoneIn(text){const m=text.replace(/[\s-]/g,' ').match(/\b\d{10}\b/);return m?m[0]:''}
function parseAmount(text){
  const phone=findPhoneIn(text);
  const all=text.match(/\d[\d,]*(?:\.\d+)?/g)||[];
  for(const raw of all){const clean=raw.replace(/,/g,'');if(phone&&clean===phone)continue;if(clean.length>=10)continue;const n=Number(clean);if(n>0)return n}
  return 0;
}
const STOP=['the','a','an','of','for','is','are','what','how','much','many','please','me','my','check','show','tell','give','balance','due','dues','baki','baaki','baanki','udharo','udhaar','udhar','khata','khaata','credit','kati','kitna','kitne','ko','ka','ki','ke','le','lai','laai','se','sang','remaining','left','rs','rupees','rupaiya','rupaya','ji','jyu','को','का','की','के','ले','लाई','सँग','से','बाँकी','बाकी','बकाया','उधारो','उधार','खाता','कति','कितना','कितने','देखाऊ','देखाउनुस्','देखाउनुहोस्','दिखाओ','दिखाइए','बताओ','बताइए','भन','भन्नुस्','हेर','हेर्ने','छ','हो','है','हैं','कसको','कस्को','किसका','किसकी','किसके','whose','who','ma','मा','mero','मेरो','mera','मेरा','meri','मेरी','saathi','sathi','साथी','record','payment','paid','received','from','add','new','naya','pay','bhuktani','tiryo','tirnu','thap','hal','lekh','likh','de','do','send','reminder','remind','whatsapp','भुक्तानी','भुगतान','थप','थप्ने','जोड','जोड़','हाल','लेख','लेख्ने','दर्ज','करें','गर','गर्ने','गर्नुस्','दे','देऊ','दो','तिर्यो','तिरेको','चुकाया','सम्झाऊ','रिमाइन्डर','रिमाइंडर'];
function leftoverQuery(text){
  return text.split(' ').filter(x=>x&&!STOP.includes(x)&&!/^\d+$/.test(x)).join(' ').trim();
}
/* Devanagari → roman transliteration so spoken Hindi/Nepali names
   can match customer names stored in English (राम कुमार → ram kumar) */
const DEV_CONS={'क':'k','ख':'kh','ग':'g','घ':'gh','ङ':'n','च':'ch','छ':'chh','ज':'j','झ':'jh','ञ':'n','ट':'t','ठ':'th','ड':'d','ढ':'dh','ण':'n','त':'t','थ':'th','द':'d','ध':'dh','न':'n','प':'p','फ':'ph','ब':'b','भ':'bh','म':'m','य':'y','र':'r','ल':'l','व':'v','श':'sh','ष':'sh','स':'s','ह':'h'};
const DEV_VOW={'अ':'a','आ':'aa','इ':'i','ई':'ii','उ':'u','ऊ':'uu','ए':'e','ऐ':'ai','ओ':'o','औ':'au','ऋ':'ri'};
const DEV_MATRA={'ा':'aa','ि':'i','ी':'ii','ु':'u','ू':'uu','े':'e','ै':'ai','ो':'o','ौ':'au','ृ':'ri','ं':'n','ँ':'n','ः':'h'};
function translit(s){
  if(!/[ऀ-ॿ]/.test(s))return s;
  let out='';
  for(const ch of s){
    if(DEV_CONS[ch])out+=DEV_CONS[ch]+'a';
    else if(DEV_VOW[ch])out+=DEV_VOW[ch];
    else if(DEV_MATRA[ch]){if(out.endsWith('a'))out=out.slice(0,-1);out+=DEV_MATRA[ch]}
    else if(ch==='्'){if(out.endsWith('a'))out=out.slice(0,-1)}
    else if(ch==='़'){}
    else out+=ch;
  }
  out=out.replace(/aa+/g,'a').replace(/ii+/g,'i').replace(/uu+/g,'u');
  return out.split(' ').map(w=>w.length>2?w.replace(/a$/,''):w).join(' ');
}

/* ---------- data access ---------- */
function data(){try{return typeof window.sdb==='function'?window.sdb():M().getDB()}catch(e){return M().getDB()}}
function balancesAll(){
  const d=data();
  if(typeof window.allCustomerBalances==='function')return window.allCustomerBalances(d);
  return d.customers.map(c=>({customer:c,...M().customerBalance(d,c.id)})).sort((a,b)=>b.balance-a.balance);
}
function searchCust(q){
  q=translit(norm(q));if(!q)return[];
  const d=data();const ph=q.replace(/\D/g,'');
  const scored=[];
  d.customers.forEach(c=>{
    const n=translit(norm(c.name));
    let s=0;
    if(n&&n===q)s=4;
    else if(n&&(n.includes(q)||q.includes(n)))s=3;
    else if(ph.length>=4&&String(c.phone||'').includes(ph))s=2;
    else if(q.split(' ').some(tok=>tok.length>=3&&n.includes(tok)))s=1;
    if(s)scored.push({c,s});
  });
  if(!scored.length)return[];
  const top=Math.max(...scored.map(x=>x.s));
  return scored.filter(x=>x.s===top).map(x=>x.c).slice(0,6);
}
function rerender(){try{if(typeof window.renderAll==='function')window.renderAll()}catch(e){}}
function isMainAdminNow(){try{return typeof window.isMainAdmin==='function'?window.isMainAdmin():M().getSession()?.role==='admin'}catch(e){return false}}

/* ---------- task helpers (dashboard) ---------- */
function doNav(page){
  if(typeof window.nav==='function'){window.nav(page);botSay(fmt(t('navved'),{p:PAGE_LABEL[page]?PAGE_LABEL[page][lang]:page}))}
}
function custActions(c,bal){
  let a='';
  if(typeof window.openStatementView==='function'||typeof window.openStatement==='function')a+=act('📄 Statement','st:'+c.id);
  if(bal>0)a+=act('💬 WhatsApp','wa:'+c.id)+act(lang==='en'?'✅ Record payment':lang==='ne'?'✅ भुक्तानी लेख्ने':'✅ भुगतान दर्ज','payc:'+c.id);
  return a;
}
function showCustBalance(c){
  const d=data();const b=M().customerBalance(d,c.id);
  const spoken=lang==='en'?c.name+' owes '+money(b.balance):lang==='ne'?c.name+' को बाँकी '+money(b.balance)+' छ':c.name+' का बकाया '+money(b.balance)+' है';
  botSay(fmt(t('custBalance'),{name:esc(c.name),phone:esc(c.phone),amt:money(b.balance),taken:money(b.taken),paid:money(b.paid)}),{acts:custActions(c,b.balance),speak:spoken});
}
function todaySummary(){
  const d=data(),today=M().today();
  const rows=d.dailySales.filter(x=>String(x.date)===today);
  const sum=f=>rows.reduce((s,x)=>s+num(x[f]),0);
  const total=['pos','fonepay','cash','finance','partyPayment','other'].reduce((s,f)=>s+sum(f),0);
  const creditsToday=d.credits.filter(x=>String(x.date)===today).reduce((s,x)=>s+num(x.amount),0);
  const salesToday=d.sales.filter(x=>String(x.date)===today).reduce((s,x)=>s+num(x.amount),0);
  const bs=typeof window.npDate==='function'?window.npDate(today):today;
  const lbl={cash:L('Cash','नगद','नकद'),pos:L('POS','POS','POS'),fonepay:L('FonePay','फोनपे','फोनपे'),finance:L('Finance','फाइनान्स','फाइनेंस'),partyPayment:L('Party payment','पार्टी भुक्तानी','पार्टी भुगतान'),other:L('Other','अन्य','अन्य')};
  let html=fmt(t('todayHead'),{d:esc(bs)});
  ['cash','pos','fonepay','finance','partyPayment','other'].forEach(f=>{const v=sum(f);if(v>0)html+=`<div class="mbot-lrow"><span>${lbl[f][lang]}</span><b>${money(v)}</b></div>`});
  html+=`<div class="mbot-lrow"><span>${lang==='en'?'Daily sales total':lang==='ne'?'दैनिक बिक्री जम्मा':'दैनिक बिक्री कुल'}</span><b>${money(total)}</b></div>`;
  html+=`<div class="mbot-lrow"><span>${lang==='en'?'Counter sales':lang==='ne'?'काउन्टर बिक्री':'काउंटर बिक्री'}</span><b>${money(salesToday)}</b></div>`;
  html+=`<div class="mbot-lrow"><span>${lang==='en'?'Credit given today':lang==='ne'?'आज दिएको उधारो':'आज दिया उधार'}</span><b>${money(creditsToday)}</b></div>`;
  botSay(html,{acts:act(lang==='en'?'Open Daily Sales':lang==='ne'?'दैनिक बिक्री खोल्ने':'दैनिक बिक्री खोलें','nav:daily'),
    speak:(lang==='en'?'Today\'s sales total is ':lang==='ne'?'आजको बिक्री जम्मा ':'आज की कुल बिक्री ')+money(total)});
}
function monthSummary(){
  const d=data(),ym=M().today().slice(0,7);
  const inM=x=>String(x.date||'').slice(0,7)===ym;
  const daily=d.dailySales.filter(inM).reduce((s,x)=>s+['pos','fonepay','cash','finance','partyPayment','other'].reduce((a,f)=>a+num(x[f]),0),0);
  const credit=d.credits.filter(inM).reduce((s,x)=>s+num(x.amount),0);
  const paid=d.credits.filter(x=>String(x.paidAt||'').slice(0,7)===ym).reduce((s,x)=>s+num(x.paid),0);
  let html=fmt(t('monthHead'),{m:ym});
  html+=`<div class="mbot-lrow"><span>${lang==='en'?'Daily sales':lang==='ne'?'दैनिक बिक्री':'दैनिक बिक्री'}</span><b>${money(daily)}</b></div>`;
  html+=`<div class="mbot-lrow"><span>${lang==='en'?'Credit given':lang==='ne'?'दिएको उधारो':'दिया उधार'}</span><b>${money(credit)}</b></div>`;
  botSay(html,{acts:act(lang==='en'?'Open Reports':lang==='ne'?'रिपोर्ट खोल्ने':'रिपोर्ट खोलें','nav:reports'),
    speak:(lang==='en'?'This month daily sales total ':lang==='ne'?'यो महिनाको दैनिक बिक्री ':'इस महीने की दैनिक बिक्री ')+money(daily)});
}
function topDues(){
  const rows=balancesAll().filter(x=>x.balance>0).slice(0,5);
  if(!rows.length){botSay(t('noDues'));return}
  let html=t('topDues');
  rows.forEach(x=>{html+=`<div class="mbot-lrow"><span>${esc(x.customer.name)}</span><b>${money(x.balance)}</b></div>`});
  botSay(html,{acts:act(lang==='en'?'Open Follow-Up':lang==='ne'?'फलो-अप खोल्ने':'फॉलो-अप खोलें','nav:followup')+act('💬 WhatsApp','waopen'),
    speak:t('topDues')+' '+rows.map(x=>x.customer.name+' '+money(x.balance)).join(', ')});
}
function duesTotal(){
  const rows=balancesAll().filter(x=>x.balance>0);
  if(!rows.length){botSay(t('noDues'));return}
  const total=rows.reduce((s,x)=>s+x.balance,0);
  botSay(fmt(t('duesTotal'),{amt:money(total),n:rows.length}),{acts:act(lang==='en'?'Top dues':lang==='ne'?'धेरै उधारो':'सबसे ज़्यादा','send:'+CHIPS.dash[2].t[lang])});
}
function waReminder(custId){
  try{
    const d=data();const c=M().customerById(d,custId);if(!c)return;
    const b=M().customerBalance(d,c.id);
    const msg=fmt(t('waBody'),{name:c.name,mart:d.settings.martName||'RD MART',amt:money(b.balance)});
    M().wa(c.phone,msg);botSay(t('waSent'));
  }catch(e){botSay(t('error')+esc(e.message))}
}

/* ---------- pro task helpers ---------- */
function addDaysIso(iso,days){const d=new Date(Date.parse(String(iso).slice(0,10))+days*86400000);return d.toISOString().slice(0,10)}
function daysDiff(a,b){return Math.round((Date.parse(String(b).slice(0,10))-Date.parse(String(a).slice(0,10)))/86400000)}
function dailyTotal(x){return ['pos','fonepay','cash','finance','partyPayment','other'].reduce((s,f)=>s+num(x[f]),0)}
function rangeTotal(d,from,to){return d.dailySales.filter(x=>{const dt=String(x.date||'').slice(0,10);return dt>=from&&dt<=to}).reduce((s,x)=>s+dailyTotal(x),0)}
function lrow(label,value){return `<div class="mbot-lrow"><span>${label}</span><b>${value}</b></div>`}
function overdueList(minDays){
  const d=data(),today=M().today();
  return d.customers.map(c=>{
    const rows=d.credits.filter(x=>x.customerId===c.id&&num(x.amount)>num(x.paid));
    if(!rows.length)return null;
    const oldest=rows.reduce((m,x)=>String(x.date)<m?String(x.date):m,'9999-12-31');
    const days=Math.max(0,daysDiff(oldest,today));
    const bal=rows.reduce((s,x)=>s+num(x.amount)-num(x.paid),0);
    return{c,days,bal};
  }).filter(x=>x&&x.days>=(minDays||7)).sort((a,b)=>b.days-a.days);
}
function chequesDueSoon(){
  const d=data(),today=M().today(),limit=addDaysIso(today,7);
  return d.cheques.filter(x=>x.status==='hold'&&String(x.chequeDate||'').slice(0,10)<=limit).sort((a,b)=>String(a.chequeDate).localeCompare(String(b.chequeDate)));
}
function pendingReqs(){return (data().paymentRequests||[]).filter(x=>x.status==='pending')}
function briefing(){
  const d=data(),today=M().today();
  const salesToday=d.dailySales.filter(x=>String(x.date)===today).reduce((s,x)=>s+dailyTotal(x),0)+d.sales.filter(x=>String(x.date)===today).reduce((s,x)=>s+num(x.amount),0);
  const dueRows=balancesAll().filter(x=>x.balance>0);
  const dueTotal=dueRows.reduce((s,x)=>s+x.balance,0);
  const reqs=pendingReqs().length,over=overdueList(7).length,chq=chequesDueSoon().length;
  const bs=typeof window.npDate==='function'?window.npDate(today):today;
  let html=fmt(t('briefHead'),{d:esc(bs)});
  html+=lrow(t('briefSales'),money(salesToday));
  html+=lrow(t('briefDues'),money(dueTotal)+' ('+dueRows.length+')');
  if(reqs)html+=lrow(t('briefReqs'),String(reqs));
  if(over)html+=lrow(t('briefOverdue'),String(over));
  if(chq)html+=lrow(t('briefCheques'),String(chq));
  if(!reqs&&!over&&!chq)html+='<div style="margin-top:8px">'+t('briefClear')+'</div>';
  let acts='';
  if(reqs)acts+=act('🔔 '+t('briefReqs'),'send:payment requests');
  if(over)acts+=act('⏰ '+t('briefOverdue'),'send:overdue');
  if(chq)acts+=act('🏦 '+t('briefCheques'),'send:cheques');
  acts+=act(lang==='en'?'📈 Weekly report':lang==='ne'?'📈 हप्ताको रिपोर्ट':'📈 हफ्ते की रिपोर्ट','send:'+(lang==='en'?'weekly report':lang==='ne'?'हप्ताको रिपोर्ट':'हफ्ते की रिपोर्ट'));
  botSay(html,{acts,speak:t('briefSales')+' '+money(salesToday)+'. '+t('briefDues')+' '+money(dueTotal)});
}
function weekSummary(){
  const d=data(),today=M().today();
  const from=addDaysIso(today,-6),prevFrom=addDaysIso(today,-13),prevTo=addDaysIso(today,-7);
  const cur=rangeTotal(d,from,today),prev=rangeTotal(d,prevFrom,prevTo);
  let best={date:'',v:0};
  d.dailySales.forEach(x=>{const dt=String(x.date||'').slice(0,10);if(dt>=from&&dt<=today){const v=dailyTotal(x);if(v>best.v)best={date:dt,v}}});
  const credit=d.credits.filter(x=>{const dt=String(x.date||'').slice(0,10);return dt>=from&&dt<=today}).reduce((s,x)=>s+num(x.amount),0);
  let html=t('wkHead');
  html+=lrow(t('wkTotal'),money(cur));
  html+=lrow(t('wkPrev'),money(prev));
  if(best.v>0)html+=lrow(t('wkBest'),(typeof window.npDate==='function'?window.npDate(best.date):best.date)+' · '+money(best.v));
  html+=lrow(t('wkCredit'),money(credit));
  if(prev>0){const p=Math.abs(Math.round((cur-prev)/prev*100));html+='<div style="margin-top:8px">'+fmt(t(cur>=prev?'wkUp':'wkDown'),{p})+'</div>'}
  botSay(html,{acts:act(PAGE_LABEL.reports[lang],'nav:reports'),speak:t('wkTotal')+' '+money(cur)});
}
function statsCard(){
  const d=data();
  const withDues=balancesAll().filter(x=>x.balance>0).length;
  let html=t('statsHead');
  html+=lrow(t('stCustomers'),String(d.customers.length));
  html+=lrow(t('stWithDues'),String(withDues));
  html+=lrow(t('stCredits'),String(d.credits.length));
  html+=lrow(t('stCheques'),String(d.cheques.filter(x=>x.status==='hold').length));
  botSay(html,{speak:t('stCustomers')+' '+d.customers.length});
}
function showProfile(c){
  const d=data();const b=M().customerBalance(d,c.id);
  let html=fmt(t('profileHead'),{name:esc(c.name)});
  html+=lrow(t('pfPhone'),esc(c.phone||'-'));
  if(c.email)html+=lrow(t('pfEmail'),esc(c.email));
  if(c.address)html+=lrow(t('pfAddress'),esc(c.address));
  html+=lrow(t('pfLimit'),num(c.creditLimit)>0?money(c.creditLimit):t('pfNoLimit'));
  html+=lrow(t('pfBalance'),money(b.balance));
  if(c.createdAt)html+=lrow(t('pfSince'),typeof window.npDate==='function'?window.npDate(String(c.createdAt).slice(0,10)):String(c.createdAt).slice(0,10));
  botSay(html,{acts:custActions(c,b.balance)+act(lang==='en'?'🔎 Open in Customers':lang==='ne'?'🔎 ग्राहक पेजमा हेर्ने':'🔎 ग्राहक पेज में देखें','srch:'+(c.phone||c.name)),speak:c.name+', '+t('pfBalance')+' '+money(b.balance)});
}
function listPayRequests(){
  const reqs=pendingReqs().slice(0,5);
  if(!reqs.length){botSay(t('reqNone'));return}
  let html=t('reqListHead');
  reqs.forEach(x=>{html+=lrow(esc(x.customer||'Customer')+(x.method?' · '+esc(x.method):''),money(x.amount))});
  const acts=reqs.map(x=>act('✅ '+esc((x.customer||'').split(' ')[0])+' '+money(x.amount),'apr:'+x.id)+act('❌','rej:'+x.id)).join('');
  botSay(html,{acts,speak:t('reqListHead')+' '+reqs.length});
}
function overdueCard(){
  const rows=overdueList(7).slice(0,6);
  if(!rows.length){botSay(t('overdueNone'));return}
  let html=t('overdueHead');
  rows.forEach(x=>{html+=lrow(esc(x.c.name)+' · '+fmt(t('daysWord'),{n:x.days}),money(x.bal))});
  const acts=rows.slice(0,3).map(x=>act('💬 '+esc((x.c.name||'').split(' ')[0]),'wa:'+x.c.id)).join('')+act(PAGE_LABEL.followup[lang],'nav:followup');
  botSay(html,{acts,speak:t('overdueHead')+' '+rows.map(x=>x.c.name+' '+money(x.bal)).join(', ')});
}
function chequesSoonCard(){
  const rows=chequesDueSoon().slice(0,6);
  if(!rows.length){botSay(t('chequeNone'),{acts:act(PAGE_LABEL.cheques[lang],'nav:cheques')});return}
  let html=t('chequeSoon');
  rows.forEach(x=>{html+=lrow(esc(x.party)+' · '+esc(x.chequeNo)+' · '+esc(String(x.chequeDate).slice(0,10)),money(x.amount))});
  botSay(html,{acts:act(PAGE_LABEL.cheques[lang],'nav:cheques')});
}
/* "cheque 12345 cleared" / "चेक बाउन्स भयो" — update status by number, or offer a pick list */
function markCheque(txt){
  const st=has(txt,['bounce','बाउन्स','बाउंस','return','फिर्ता','वापस'])?'bounce':'clear';
  const no=(txt.match(/\d{3,}/)||[])[0];
  const holds=data().cheques.filter(x=>x.status==='hold');
  if(no){
    const chosen=holds.find(x=>String(x.chequeNo).includes(no));
    if(!chosen){botSay(fmt(t('chequeNotFound'),{no:esc(no)}));return}
    doMarkCheque(chosen.id,st);return;
  }
  if(!holds.length){botSay(t('chequeNone'));return}
  botSay(t('chequePickMark'),{acts:holds.slice(0,4).map(x=>act(esc(x.chequeNo)+' · '+esc((x.party||'').split(' ')[0])+' · '+money(x.amount),'chq:'+x.id+'|'+st)).join('')});
}
function doMarkCheque(cid,st){
  try{
    const d=data();const ch=d.cheques.find(x=>x.id===cid);if(!ch)return;
    M().updateChequeStatus(d,cid,st);rerender();
    botSay(fmt(t('chequeMarkDone'),{no:esc(ch.chequeNo),party:esc(ch.party),amt:money(ch.amount),st:st==='clear'?'✅ clear':'⚠️ bounce'}));
  }catch(e){botSay(t('error')+esc(e.message))}
}
function storeSwitchCard(){
  const stores=M().getStores();
  if(stores.length<=1){botSay(t('oneStore'));return}
  const cur=M().getActiveStoreId();
  botSay(t('pickStore'),{acts:stores.slice(0,4).map(s=>act((s.id===cur?'✔ ':'🏪 ')+esc(s.name),'store:'+s.id)).join('')});
}
function lastBackupCard(){
  const ts=localStorage.getItem('martai_last_backup_ts');
  let d='';
  if(ts){try{d=new Date(ts).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}catch(e){d=ts}}
  botSay(ts?fmt(t('lastBackupAt'),{d:esc(d)}):t('lastBackupNever'),{acts:act('💾 Backup','send:backup')});
}
function menuCard(){
  const items=[
    L('📋 Briefing','📋 ब्रिफिङ','📋 ब्रीफिंग'),
    L("📊 Today's sales",'📊 आजको बिक्री','📊 आज की बिक्री'),
    L('📈 Weekly report','📈 हप्ताको रिपोर्ट','📈 हफ्ते की रिपोर्ट'),
    L('📅 This month','📅 यो महिना','📅 इस महीने'),
    L('💰 Total dues','💰 जम्मा उधारो','💰 कुल उधार'),
    L('🏆 Top dues','🏆 धेरै उधारो','🏆 सबसे ज़्यादा उधार'),
    L('⏰ Overdue','⏰ ढिला उधारो','⏰ लेट उधार'),
    L('📊 Stats','📊 आँकडा','📊 आंकड़े'),
    L('👤 Add customer','👤 नयाँ ग्राहक','👤 नया ग्राहक'),
    L('🧾 Add credit','🧾 उधारो थप्ने','🧾 उधार जोड़ें'),
    L('✅ Record payment','✅ भुक्तानी लेख्ने','✅ भुगतान दर्ज करें'),
    L('🛒 Add sale','🛒 बिक्री थप्ने','🛒 बिक्री जोड़ें'),
    L('💵 Daily entry','💵 दैनिक बिक्री लेख्ने','💵 दैनिक बिक्री दर्ज'),
    L('🏦 Add cheque','🏦 चेक थप्ने','🏦 चेक जोड़ें'),
    L('🏦 Cheques due','🏦 आउने चेक','🏦 आने वाले चेक'),
    L('📄 New estimate','📄 नयाँ इस्टिमेट','📄 नया एस्टीमेट'),
    L('🔔 Payment requests','🔔 पेन्डिङ रिपोर्ट','🔔 पेंडिंग रिपोर्ट'),
    L('💬 Send reminder','💬 रिमाइन्डर पठाऊ','💬 रिमाइंडर भेजो'),
    L('💾 Backup','💾 ब्याकअप','💾 बैकअप'),
    L('📄 Export CSV','📄 CSV','📄 CSV'),
    L('🔄 Sync','🔄 सिंक','🔄 सिंक'),
    L('🧮 Calculator: 250*4+100','🧮 हिसाब: 250*4+100','🧮 हिसाब: 250*4+100')
  ];
  botSay(t('menuHead'),{acts:items.map(x=>act(esc(x[lang]),'send:'+x[lang])).join(''),speak:t('greetBack')});
}
/* Safe arithmetic — digits and + - * / % ( ) only, no eval */
function calcExpr(raw){
  const s=raw.replace(/,/g,'').replace(/\s+/g,'');
  if(!/^[\d+\-*/%().]+$/.test(s)||!/[+\-*/%]/.test(s)||!/\d/.test(s))return null;
  let i=0;
  function expr(){let v=term();while(s[i]==='+'||s[i]==='-'){const op=s[i++];const r=term();if(r===null)return null;v=op==='+'?v+r:v-r}return v}
  function term(){let v=factor();while(s[i]==='*'||s[i]==='/'||s[i]==='%'){const op=s[i++];const r=factor();if(r===null||v===null)return null;v=op==='*'?v*r:op==='/'?v/r:v%r}return v}
  function factor(){if(s[i]==='('){i++;const v=expr();if(s[i]===')')i++;return v}let j=i;while(j<s.length&&/[\d.]/.test(s[j]))j++;if(j===i)return null;const v=Number(s.slice(i,j));i=j;return Number.isFinite(v)?v:null}
  try{const v=expr();return(i>=s.length&&v!==null&&Number.isFinite(v))?Math.round(v*100)/100:null}catch(e){return null}
}
/* "cash 5000 pos 2000 fonepay 300" (also नगद/पोस/फोनपे…) -> daily sales fields */
function parseDailyCombo(txt){
  const map={cash:['cash','नगद','nagad','नकद','nakad'],pos:['pos','पोस'],fonepay:['fonepay','फोनपे','fone','phonepay','fonepe'],finance:['finance','फाइनान्स','फाइनेंस'],partyPayment:['party','पार्टी'],other:['other','अन्य','अरू','aru']};
  const tokens=txt.split(' ');const out={};let found=false;
  for(let i=0;i<tokens.length-1;i++){
    for(const k in map){
      if(map[k].includes(tokens[i])){
        const v=num(tokens[i+1]);
        if(v>0||tokens[i+1]==='0'){out[k]=v;found=true}
      }
    }
  }
  if(!found){const a=parseAmount(txt);if(a>0){out.cash=a;found=true}}
  return found?out:null;
}

/* ---------- flows (multi-turn tasks) ---------- */
const FLOWS={
  addCustomer:{fields:['name','phone','pin']},
  credit:{fields:['customer','amount','items']},
  payment:{fields:['customer','amount']},
  sale:{fields:['amount','party']},
  cheque:{fields:['party2','chequeNo','amount','bank']},
  estimate:{fields:['party','amount','items']},
  daily:{fields:['combo']},
  limit:{fields:['customer','amount']},
  custpay:{fields:['amount','method','reference']}
};
const PROMPTS={name:'askName',phone:'askPhone',pin:'askPin',customer:'askCustomer',amount:'askAmount',items:'askItems',party:'askParty',party2:'askParty2',chequeNo:'askChequeNo',bank:'askBank',combo:'askDaily',method:'askMethod',reference:'askReference'};
const CANCEL_WORDS=['cancel','stop','band','chhod','chod','quit','exit','रद्द','बन्द','बंद','रोक','छोड'];
const YES_WORDS=['yes','y','ok','okay','sure','ho','hunxa','huncha','garnus','gara','haan','han','ha','हो','हुन्छ','गर','गर्नुस्','हाँ','ठीक','थिक','ok cha'];
const NO_WORDS=['no','n','nah','hoina','nagara','nahi','nahin','होइन','नगर','नहीं','ना','रद्द'];

function startFlow(type,pre){flow={type,step:'',data:pre||{}};flowNext()}
function flowNext(){
  const def=FLOWS[flow.type];
  for(const f of def.fields){if(flow.data[f]===undefined){flow.step=f;botSay(t(PROMPTS[f]));return}}
  flow.step='confirm';
  const d=flow.data;
  let msg='';
  if(flow.type==='addCustomer')msg=fmt(t('cfCustomer'),{name:esc(d.name),phone:esc(d.phone),pin:esc(d.pin)});
  if(flow.type==='credit')msg=fmt(t('cfCredit'),{name:esc(d.customerName),amt:money(d.amount),items:d.items?' ('+esc(d.items)+')':''});
  if(flow.type==='payment')msg=fmt(t('cfPayment'),{name:esc(d.customerName),amt:money(d.amount)});
  if(flow.type==='sale')msg=fmt(t('cfSale'),{amt:money(d.amount),party:esc(d.party||'Walk-in')});
  if(flow.type==='cheque')msg=fmt(t('cfCheque'),{no:esc(d.chequeNo),party:esc(d.party2),amt:money(d.amount),bank:d.bank?' · '+esc(d.bank):''});
  if(flow.type==='estimate')msg=fmt(t('cfEstimate'),{amt:money(d.amount),party:esc(d.party||'Walk-in'),items:d.items?' ('+esc(d.items)+')':''});
  if(flow.type==='daily'){
    const total=Object.values(d.combo).reduce((s,v)=>s+num(v),0);
    const rows=Object.keys(d.combo).map(k=>lrow(esc(k),money(d.combo[k]))).join('');
    msg=fmt(t('cfDaily'),{amt:money(total),rows});
  }
  if(flow.type==='limit')msg=fmt(t('cfLimit'),{amt:money(d.amount),name:esc(d.customerName)});
  if(flow.type==='custpay')msg=fmt(t('cfCustPay'),{amt:money(d.amount),method:esc(d.method||'Cash'),ref:d.reference?' · '+esc(d.reference):''});
  botSay(msg,{acts:act(UI.yes[lang],'cf:yes')+act(UI.no[lang],'cf:no')});
}
function flowCancel(){flow=null;botSay(t('cancelled'))}
function flowExec(){
  const f=flow;flow=null;
  try{
    const d=M().getDB();
    if(f.type==='addCustomer'){
      const c=M().addCustomer(d,{name:f.data.name,phone:f.data.phone,pin:f.data.pin});
      rerender();botSay(fmt(t('doneCustomer'),{name:esc(c.name),phone:esc(c.phone)}));
    }else if(f.type==='credit'){
      M().addCredit(d,{customerId:f.data.customerId,amount:f.data.amount,items:f.data.items||''});
      rerender();const b=M().customerBalance(d,f.data.customerId);
      botSay(fmt(t('doneCredit'),{name:esc(f.data.customerName),bal:money(b.balance)}));
    }else if(f.type==='payment'){
      const applied=M().addCreditPayment(d,f.data.customerId,f.data.amount,'Saathi assistant');
      rerender();const b=M().customerBalance(d,f.data.customerId);
      let extraNote=applied<f.data.amount?'<br>'+fmt(t('overPaid'),{extra:money(f.data.amount-applied)}):'';
      botSay(fmt(t('donePayment'),{amt:money(applied),name:esc(f.data.customerName),bal:money(b.balance)})+extraNote);
    }else if(f.type==='sale'){
      M().addSale(d,{amount:f.data.amount,party:f.data.party||'Walk-in Customer'});
      rerender();botSay(fmt(t('doneSale'),{amt:money(f.data.amount),party:esc(f.data.party||'Walk-in')}));
    }else if(f.type==='cheque'){
      const ch=M().addCheque(d,{party:f.data.party2,chequeNo:f.data.chequeNo,amount:f.data.amount,bank:f.data.bank||''});
      rerender();botSay(fmt(t('doneCheque'),{no:esc(ch.chequeNo),amt:money(ch.amount)}));
    }else if(f.type==='estimate'){
      M().addEstimateBill(d,{customer:f.data.party||'Walk-in Customer',amount:f.data.amount,items:f.data.items||''});
      rerender();botSay(fmt(t('doneEstimate'),{amt:money(f.data.amount),party:esc(f.data.party||'Walk-in')}));
    }else if(f.type==='daily'){
      const row=M().addDaily(d,f.data.combo);
      rerender();
      const bs=typeof window.npDate==='function'?window.npDate(row.date):row.date;
      botSay(fmt(t('doneDaily'),{amt:money(dailyTotal(row)),d:esc(bs)}));
    }else if(f.type==='limit'){
      M().updateCustomer(d,f.data.customerId,{creditLimit:f.data.amount});
      rerender();botSay(fmt(t('doneLimit'),{name:esc(f.data.customerName),amt:money(f.data.amount)}));
    }else if(f.type==='custpay'){
      M().customerRequestPayment({amount:f.data.amount,method:f.data.method||'Cash',reference:f.data.reference||''})
        .then(()=>{rerender();botSay(fmt(t('custPayDone'),{amt:money(f.data.amount)}))})
        .catch(e=>botSay(t('custPayNeedOnline')+'<br><small>'+esc(e.message||'')+'</small>'));
    }
  }catch(e){botSay(t('error')+esc(e.message))}
}
function flowInput(raw){
  const txt=norm(raw);
  if(has(txt,CANCEL_WORDS)&&txt.split(' ').length<=3){flowCancel();return}
  if(flow.step==='confirm'){
    if(YES_WORDS.includes(txt)||has(txt,['हुन्छ','हाँ','yes','ho '])){flowExec();return}
    if(NO_WORDS.includes(txt)||has(txt,['होइन','नहीं','no '])){flowCancel();return}
    /* user changed topic mid-confirm — drop the pending task and handle the new request */
    if(txt.split(' ').length>=2){flow=null;botSay(t('cancelled'),{speak:null});handleText(raw);return}
    botSay(t('unknown'),{acts:act(UI.yes[lang],'cf:yes')+act(UI.no[lang],'cf:no')});return;
  }
  const step=flow.step;
  if(step==='name'){
    const v=String(raw).trim();
    if(v.length<2){botSay(t('badName'));return}
    flow.data.name=v;
  }else if(step==='phone'){
    const ph=digitsAscii(raw).replace(/\D/g,'').slice(-10);
    if(ph.length<10){botSay(t('badPhone'));return}
    flow.data.phone=ph;
  }else if(step==='pin'){
    const p=digitsAscii(raw).replace(/\D/g,'');
    if(!/^\d{4}$/.test(p)){botSay(t('badPin'));return}
    flow.data.pin=p;
  }else if(step==='amount'){
    const a=parseAmount(txt);
    if(a<=0){botSay(t('badAmount'));return}
    flow.data.amount=a;
  }else if(step==='items'||step==='party'||step==='bank'||step==='reference'||step==='method'){
    const skip=['skip','no','none','nai','xaina','chaina','छैन','नहीं','कुनै','koi nahi','-'];
    const v=skip.includes(txt)?'':String(raw).trim();
    flow.data[step]=step==='party'&&!v?'Walk-in Customer':step==='method'&&!v?'Cash':v;
  }else if(step==='party2'){
    const v=String(raw).trim();
    if(v.length<2){botSay(t('badName'));return}
    flow.data.party2=v;
  }else if(step==='chequeNo'){
    const v=String(raw).trim();
    if(!v){botSay(t('askChequeNo'));return}
    flow.data.chequeNo=v;
  }else if(step==='combo'){
    const combo=parseDailyCombo(txt);
    if(!combo){botSay(t('badDaily'));return}
    flow.data.combo=combo;
  }else if(step==='customer'){
    const found=searchCust(raw);
    if(!found.length){botSay(fmt(t('custNotFound'),{q:esc(raw)}),{acts:act(UI.no[lang],'cf:no')});return}
    if(found.length>1){
      botSay(t('pickCustomer'),{acts:found.slice(0,4).map(c=>act(esc(c.name)+' · '+esc(c.phone),'pickc:'+c.id)).join('')});
      return;
    }
    flow.data.customerId=found[0].id;flow.data.customerName=found[0].name;flow.data.customer=found[0].id;
  }
  flowNext();
}
function resolveCustomerPre(pre,query){
  if(!query)return pre;
  const found=searchCust(query);
  if(found.length===1){pre.customer=found[0].id;pre.customerId=found[0].id;pre.customerName=found[0].name}
  return pre;
}

/* ---------- intent engine ---------- */
const NAV_WORDS={
  dashboard:['dashboard','home','ड्यासबोर्ड','डैशबोर्ड','होम'],
  customers:['customers','customer list','grahak','ग्राहक सूची','ग्राहक लिस्ट','ग्राहकहरू'],
  credits:['credit book','credits','khata','khaata','उधारो खाता','उधार खाता','खाता','ledger','credit page'],
  daily:['daily','दैनिक'],
  payments:['party payment','party payments','पार्टी भुक्तानी','पार्टी भुगतान'],
  cheques:['cheque','cheques','check page','चेक'],
  estimates:['estimate','estimates','quotation','इस्टिमेट','एस्टीमेट','अनुमान'],
  reports:['report','reports','रिपोर्ट'],
  followup:['follow','followup','follow-up','फलो','फॉलो','priority'],
  settings:['setting','settings','सेटिङ','सेटिंग']
};
const OPEN_VERBS=['open','go to','goto','show','खोल','खोलो','खोल्','जाऊ','जाओ','ले जाओ','देखाऊ','दिखाओ','kholnus','khol','kholo','dekhau','dikhao','जानुस'];
function navPageFrom(txt){
  const hasVerb=has(txt,OPEN_VERBS);
  for(const page in NAV_WORDS){
    if(has(txt,NAV_WORDS[page])){
      if(hasVerb||txt.split(' ').length<=3)return page;
    }
  }
  return '';
}
const KW={
  greet:['hi','hii','hello','hey','namaste','namaskar','नमस्ते','नमस्कार','ओइ','oi saathi','hello saathi'],
  howru:['how are you','k cha','k xa','kasto cha','kasto xa','कस्तो छ','के छ','कैसे हो','कैसा है','kaise ho'],
  who:['who are you','what are you','timi ko','तिमी को','को हौ','तुम कौन','कौन हो','kaun ho','tum kaun','about you'],
  thanks:['thank','thanks','dhanyabad','dhanyawad','धन्यवाद','शुक्रिया','shukriya'],
  bye:['bye','goodbye','tata','बिदा','अलविदा'],
  help:['help','madad','maddat','sahayog','मद्दत','मदत','मदद','सहयोग','what can you do','के गर्न सक्छौ','क्या कर सकते'],
  time:['time','date','samaya','समय','मिति','तारीख','कति बज','कितने बज','aaja kati gate','गते'],
  today:['today','aaja','aaj','आज'],
  sales:['sale','sales','bikri','बिक्री','बेचें'],
  summary:['summary','हिसाब','hisab','सारांश'],
  month:['month','mahina','mahine','महिना','महीना','महिने'],
  total:['total','kul','jamma','जम्मा','कुल','सबै गरेर','सब मिलाकर'],
  top:['top','highest','sabse','sabbhanda','sab bhanda','धेरै','सबैभन्दा','ज़्यादा','जास्ती','ज्यादा','who owes','most'],
  dues:['due','dues','baki','baaki','baanki','udharo','udhaar','udhar','बाँकी','बाकी','बकाया','उधारो','उधार','outstanding','balance'],
  addC:['add customer','new customer','naya grahak','नयाँ ग्राहक','नया ग्राहक','ग्राहक थप','ग्राहक जोड','customer add','create customer','register customer'],
  addCr:['add credit','new credit','give credit','credit de','उधारो थप','उधारो हाल','उधारो लेख','उधार जोड','उधार लिख','उधार दे','udharo thap','udharo hal','udharo lekh','udhaar likh','udhaar jodo','credit add','credit likh'],
  pay:['payment','paid','received','tirnu','tiryo','tirekoo','jamma garyo','bhuktani','भुक्तानी','भुगतान','तिर्','जम्मा गर','चुकाया','चुका','clear dues','record payment','pay receive','le liya','ले लियो'],
  addSale:['add sale','new sale','sale record','बिक्री थप','बिक्री लेख','बिक्री जोड','bikri thap','bikri lekh','sale add','record sale'],
  backup:['backup','ब्याकअप','बैकअप','बैक अप'],
  csv:['csv','excel','export','एक्सपोर्ट','एक्सेल'],
  sync:['sync','refresh','reload','सिंक','रिफ्रेस','रिफ्रेश','ताजा'],
  dark:['dark','डार्क','अँध्यारो','अंधेरा','रात'],
  light:['light','लाइट','उज्यालो','उजाला'],
  theme:['theme','थिम','थीम','mode'],
  reminder:['reminder','remind','whatsapp','wa ','सम्झाऊ','रिमाइन्डर','रिमाइंडर','याद दिला','message pathau','सन्देश','संदेश'],
  reqs:['payment request','payment report','pending request','अनुरोध','रिपोर्ट आएको','pending report','requests'],
  logout:['logout','log out','sign out','लगआउट','बाहिर निस्क','साइन आउट'],
  mine:['my','mero','mera','meri','मेरो','मेरा','मेरी','malai','मलाई','mujhe','मुझे','maile','मैले'],
  list:['list','history','सूची','लिस्ट','विवरण','इतिहास','details'],
  qr:['qr','क्यूआर','scan','स्क्यान','स्कैन'],
  pin:['pin','पिन'],
  loginHow:['login','log in','लगइन','लॉगिन','लग इन','कसरी छिर','कैसे घुस'],
  about:['what is','k ho','के हो','क्या है','about','बारेमा','बारे में'],
  forgot:['forgot','birse','बिर्स','भूल'],
  search:['search','find','khoj','खोज','ढूँढ','ढूंढ']
};

function handleText(raw){
  const txt=norm(raw);
  if(!txt)return;
  if(flow){flowInput(raw);return}
  const words=txt.split(' ');

  /* language switching */
  if(has(txt,['nepali','नेपाली','नेपालीमा'])&&has(txt,['speak','bol','बोल','भाषा','language','ma','me','में','मा'])||txt==='नेपाली'||txt==='nepali'){setLang('ne');return}
  if(has(txt,['hindi','हिंदी','हिन्दी'])&&has(txt,['speak','bol','बोल','भाषा','language','me','में'])||txt==='हिंदी'||txt==='hindi'){setLang('hi');return}
  if(has(txt,['english','अंग्रेजी','अङ्ग्रेजी'])&&has(txt,['speak','bol','बोल','भाषा','language','ma','me','में','मा'])||txt==='english'){setLang('en');return}
  /* voice */
  if(has(txt,['voice off','mute','आवाज बन्द','आवाज़ बंद','चुप','quiet'])){voiceOn=false;localStorage.setItem(LS_VOICE,'off');applyLangUI();botSay(t('voiceOffMsg'),{speak:null});return}
  if(has(txt,['voice on','unmute','आवाज खोल','आवाज़ चालू','बोल्ने गर','speak up'])){voiceOn=true;localStorage.setItem(LS_VOICE,'on');applyLangUI();botSay(t('voiceOnMsg'));return}
  /* small talk */
  if(has(txt,KW.howru)){botSay(t('howAreYou'));return}
  if(has(txt,KW.who)){botSay(t('whoAmI'));return}
  if(has(txt,KW.thanks)){botSay(t('thanks'));return}
  if(has(txt,KW.bye)&&words.length<=3){botSay(t('bye'));return}
  if((words.some(w=>KW.greet.includes(w))&&words.length<=4)||txt==='साथी'||txt==='saathi'||txt==='oi'||txt==='ओइ'){
    const h=new Date().getHours();
    const g=h<12?t('goodMorning'):h<17?t('goodAfternoon'):t('goodEvening');
    botSay(g+'! '+t('greetBack'));return;
  }
  if(has(txt,['menu','मेनु','मेन्यू'])&&words.length<=3){
    if(MODE==='dash')menuCard();else botSay(t(MODE==='cust'?'helpCust':'helpLogin'));
    return;
  }
  if(has(txt,KW.help)&&words.length<=5){
    botSay(t(MODE==='dash'?'helpDash':MODE==='cust'?'helpCust':'helpLogin'),
      {speak:t('greetBack'),acts:MODE==='dash'?act(lang==='en'?'🗂 Full menu':lang==='ne'?'🗂 पूरा मेनु':'🗂 पूरा मेन्यू','send:menu'):''});
    return;
  }
  /* store info — works on every page */
  if(has(txt,['rd mart','rdmart','आर डी मार्ट','आरडी मार्ट'])&&(has(txt,KW.about)||words.length<=5)){botSay(t('aboutApp'));return}
  if(has(txt,['खुल','khul','open','बन्द','बंद','band ','close'])&&has(txt,['mart','store','पसल','दुकान','shop','samaya','बजे','कहिले','कब','कति','hour','time'])){botSay(t('storeHours'));return}
  if(has(txt,['where','कहाँ','कहां','kaha','location','ठेगाना','पता','address'])&&has(txt,['mart','store','पसल','दुकान','shop'])){botSay(t('storeLoc'));return}
  /* calculator — "250*4+100" or "calculate 1500/3" (never a phone number) */
  if(!findPhoneIn(txt)){
    const mathTxt=txt.replace(/,/g,'');
    if(/^[\d+\-*/%(). ]+$/.test(mathTxt)&&/[+\-*/%]/.test(mathTxt)&&/\d/.test(mathTxt)){
      const ans=calcExpr(mathTxt);
      if(ans!==null){botSay(fmt(t('calcAns'),{expr:esc(raw.trim()),ans:esc(ans.toLocaleString('en-IN'))}));return}
    }
    if(has(txt,['calculate','calc ','हिसाब गर','kitna hota','कति हुन्छ','कितना होता'])){
      const m=mathTxt.match(/[-\d(][\d+\-*/%(). ]*\d\)?/);
      if(m&&/[+\-*/%]/.test(m[0])){
        const ans=calcExpr(m[0].trim());
        if(ans!==null){botSay(fmt(t('calcAns'),{expr:esc(m[0].trim()),ans:esc(ans.toLocaleString('en-IN'))}));return}
      }
    }
  }
  if(has(txt,KW.time)&&words.length<=5){
    const dt=new Date();
    const time=dt.toLocaleTimeString(lang==='en'?'en-US':'ne-NP',{hour:'2-digit',minute:'2-digit'});
    const ad=dt.toDateString();
    let bs='';try{if(typeof window.npDate==='function'&&M())bs=' · '+window.npDate(M().today())}catch(e){}
    botSay(fmt(t('timeIs'),{time,ad,bs}));return;
  }
  if(!M()){botSay(t('unknown'));return}

  if(MODE==='dash'){if(dashIntents(txt,raw,words))return}
  else if(MODE==='cust'){if(custIntents(txt,words))return}
  else{if(loginIntents(txt))return}

  /* unknown */
  const q=leftoverQuery(txt);
  let acts='';
  if(MODE==='dash'&&typeof window.openCommand==='function'&&q)acts=act(fmt(t('searchBtn'),{q:esc(q.slice(0,24))}),'cmd:'+q);
  botSay(t('unknown'),{acts});
}

function dashIntents(txt,raw,words){
  const amt=parseAmount(txt);
  /* logout */
  if(has(txt,KW.logout)){botSay(t('loggedOut'));setTimeout(()=>{M().clearSession();location.href='index.html'},900);return true}
  /* last backup time — check before the backup action itself */
  if(has(txt,KW.backup)&&has(txt,['last','when','kahile','कहिले','कब','आखिरी','अन्तिम'])){lastBackupCard();return true}
  /* backup */
  if(has(txt,KW.backup)){
    if(!isMainAdminNow()){botSay(t('adminOnly'));return true}
    if(typeof window.backupJson==='function'){window.backupJson();botSay(t('backupDone'))}
    return true;
  }
  /* csv export */
  if(has(txt,KW.csv)){
    const items=[['downloadCustomersCSV',L('👥 Customers','👥 ग्राहक','👥 ग्राहक')],['downloadBalanceCSV',L('💰 Balances','💰 बाँकी','💰 बकाया')],['downloadDailyCSV',L('📊 Daily sales','📊 दैनिक बिक्री','📊 दैनिक बिक्री')],['downloadPaymentsCSV',L('🧾 Payments','🧾 भुक्तानी','🧾 भुगतान')],['downloadChequesCSV',L('🏦 Cheques','🏦 चेक','🏦 चेक')]];
    const acts=items.filter(x=>typeof window[x[0]]==='function').map(x=>act(x[1][lang],'csv:'+x[0])).join('');
    botSay(t('csvOffer'),{acts});return true;
  }
  /* sync */
  if(has(txt,KW.sync)){
    M().syncNow().then(()=>{rerender();botSay(t('synced'))}).catch(e=>botSay(t('syncFail')+esc(e.message)));
    return true;
  }
  /* theme */
  if(has(txt,KW.dark)&&(has(txt,KW.theme)||words.length<=3)){if(typeof window.applyTheme==='function')window.applyTheme('dark');botSay(t('themeSet'));return true}
  if(has(txt,KW.light)&&(has(txt,KW.theme)||words.length<=3)){if(typeof window.applyTheme==='function')window.applyTheme('light');botSay(t('themeSet'));return true}
  /* payment requests — list with one-tap approve / reject */
  if(has(txt,KW.reqs)){listPayRequests();return true}
  /* whatsapp reminder */
  if(has(txt,KW.reminder)){
    const q=leftoverQuery(txt.split(' ').filter(x=>!KW.reminder.some(k=>k.trim()===x)).join(' '));
    if(q){const found=searchCust(q);if(found.length===1){waReminder(found[0].id);return true}}
    if(typeof window.openWaReminder==='function'){window.openWaReminder();botSay(t('waSent'),{speak:null})}else topDues();
    return true;
  }
  /* ---- pro intents ---- */
  /* switch store */
  if(has(txt,['switch store','change store','store badal','store fer','पसल फेर','पसल बदल','दुकान बदल','अर्को पसल','दूसरी दुकान'])){
    if(!isMainAdminNow()){botSay(t('adminOnly'));return true}
    storeSwitchCard();return true;
  }
  /* daily briefing */
  if(has(txt,['briefing','brief','ब्रिफिङ','ब्रीफिंग','आजको अवस्था','आज का हाल','din kasto','सुबह की रिपोर्ट'])){briefing();return true}
  /* weekly report */
  if(has(txt,['week','weekly','हप्ता','हफ्ता','हफ्ते','सात दिन','७ दिन','7 din','7 days'])&&!has(txt,['cheque','चेक'])){weekSummary();return true}
  /* store stats */
  if(has(txt,['stats','statistic','snapshot','झलक','आँकडा','आंकड़े','tathyanka','how many customer','kati grahak','कति ग्राहक','कितने ग्राहक'])){statsCard();return true}
  /* overdue customers */
  if(has(txt,['overdue','ढिला','dhila','late payer','purano udharo','पुरानो उधारो','पुराना उधार'])){overdueCard();return true}
  /* credit limit */
  if(has(txt,['limit','सीमा','seema'])){
    let pre={};if(amt>0)pre.amount=amt;
    const q=leftoverQuery(txt.split(' ').filter(x=>!['limit','सीमा','seema','set','राख','रख','रखो'].includes(x)).join(' '));
    pre=resolveCustomerPre(pre,q);
    startFlow('limit',pre);return true;
  }
  /* cheques: add / mark clear-bounce / due soon */
  if(has(txt,['cheque','चेक'])){
    if(has(txt,['add','new','received','आयो','थप','जोड','naya','नयाँ','नया'])){startFlow('cheque',amt>0?{amount:amt}:{});return true}
    if(has(txt,['clear','pass','bounce','बाउन्स','बाउंस','return','फिर्ता','वापस','क्लियर','पास'])){markCheque(txt);return true}
    if(has(txt,['due','soon','आउने','आने','week','हप्ता','हफ्ते'])){chequesSoonCard();return true}
  }
  /* daily sales entry — "daily entry cash 5000 pos 2000 fonepay 300" */
  {
    const wantsEntry=has(txt,['daily','दैनिक','dainik'])&&has(txt,['entry','save','add','लेख','हाल','थप','दर्ज','सेभ','सेव','likh','lekh','thap']);
    const combo=has(txt,['daily','दैनिक','dainik'])?parseDailyCombo(txt):null;
    if(combo&&Object.keys(combo).length&&(wantsEntry||amt>0)){flow={type:'daily',step:'',data:{combo}};flowNext();return true}
    if(wantsEntry){startFlow('daily');return true}
  }
  /* estimate bill */
  if(has(txt,['estimate','quotation','इस्टिमेट','एस्टीमेट'])&&has(txt,['add','new','make','create','बना','थप','जोड','नयाँ','नया','naya','banau','banao'])){
    startFlow('estimate',amt>0?{amount:amt}:{});return true;
  }
  /* customer profile */
  if(has(txt,['profile','प्रोफाइल','jankari','जानकारी','info of','details of','ke bare','बारेमा','के बारे'])){
    const q=leftoverQuery(txt.split(' ').filter(x=>!['profile','प्रोफाइल','jankari','जानकारी','info','details','बारेमा','बारे','bare','ke'].includes(x)).join(' '));
    if(q){
      const found=searchCust(q);
      if(found.length===1){showProfile(found[0]);return true}
      if(found.length>1){botSay(t('pickCustomer'),{acts:found.slice(0,4).map(c=>act(esc(c.name)+' · '+esc(c.phone),'prof:'+c.id)).join('')});return true}
      botSay(fmt(t('custNotFound'),{q:esc(q)}));return true;
    }
  }
  /* add customer */
  if(has(txt,KW.addC)){
    const pre={};const ph=findPhoneIn(txt);if(ph)pre.phone=ph;
    startFlow('addCustomer',pre);return true;
  }
  /* add credit */
  if(has(txt,KW.addCr)||(has(txt,['udharo','उधारो','udhaar','उधार','credit'])&&amt>0)){
    let pre={};if(amt>0)pre.amount=amt;
    const q=leftoverQuery(txt.split(' ').filter(x=>!['add','new','naya','नयाँ','नया','थप','थप्ने','जोड','जोड़ें','हाल','लेख','de','दे','likh'].includes(x)).join(' '));
    pre=resolveCustomerPre(pre,q);
    startFlow('credit',pre);return true;
  }
  /* record payment */
  if(has(txt,KW.pay)&&!has(txt,['party payment','पार्टी'])){
    let pre={};if(amt>0)pre.amount=amt;
    const q=leftoverQuery(txt);
    pre=resolveCustomerPre(pre,q);
    startFlow('payment',pre);return true;
  }
  /* add sale */
  if(has(txt,KW.addSale)){
    let pre={};if(amt>0)pre.amount=amt;
    startFlow('sale',pre);return true;
  }
  /* today's summary */
  if((has(txt,KW.today)&&(has(txt,KW.sales)||has(txt,KW.summary)))||txt==='summary'||txt==='हिसाब'){todaySummary();return true}
  /* month summary */
  if(has(txt,KW.month)){monthSummary();return true}
  /* top dues */
  if(has(txt,KW.top)&&has(txt,KW.dues)){topDues();return true}
  /* total dues */
  if(has(txt,KW.total)&&has(txt,KW.dues)){duesTotal();return true}
  /* cheques on hold (list) */
  if(has(txt,['cheque','चेक'])&&!has(txt,OPEN_VERBS)&&!has(txt,KW.dues)){
    const rows=data().cheques.filter(x=>x.status==='hold').slice(0,6);
    if(!rows.length){botSay(t('chequeNone'),{acts:act(PAGE_LABEL.cheques[lang],'nav:cheques')});return true}
    let html=t('chequeHead');
    rows.forEach(x=>{html+=`<div class="mbot-lrow"><span>${esc(x.party)} · ${esc(x.chequeNo)}</span><b>${money(x.amount)}</b></div>`});
    botSay(html,{acts:act(PAGE_LABEL.cheques[lang],'nav:cheques')});return true;
  }
  /* navigation */
  const page=navPageFrom(txt);
  if(page){doNav(page);return true}
  /* customer balance query */
  if(has(txt,KW.dues)||has(txt,KW.search)){
    const q=leftoverQuery(txt);
    if(q){
      const found=searchCust(q);
      if(found.length===1){showCustBalance(found[0]);return true}
      if(found.length>1){
        botSay(t('pickCustomer'),{acts:found.slice(0,4).map(c=>act(esc(c.name)+' · '+esc(c.phone),'bal:'+c.id)).join('')});
        return true;
      }
      if(has(txt,KW.dues)){botSay(fmt(t('custNotFound'),{q:esc(q)}),{acts:typeof window.openCommand==='function'?act(fmt(t('searchBtn'),{q:esc(q.slice(0,24))}),'cmd:'+q):''});return true}
    }else if(has(txt,KW.dues)){
      duesTotal();return true;
    }
  }
  /* bare name lookup — "ram" */
  if(words.length<=3){
    const found=searchCust(txt);
    if(found.length===1){showCustBalance(found[0]);return true}
    if(found.length>1){botSay(t('pickCustomer'),{acts:found.slice(0,4).map(c=>act(esc(c.name)+' · '+esc(c.phone),'bal:'+c.id)).join('')});return true}
  }
  return false;
}

function custIntents(txt,words){
  const self=()=>{const d=M().getDB();return d.customers[0]};
  if(has(txt,KW.logout)){botSay(t('loggedOut'));setTimeout(()=>{M().clearSession();location.href='index.html'},900);return true}
  if(has(txt,KW.qr)){custTab('overview');botSay(t('custQr'));return true}
  if(has(txt,KW.pin)){custTab('profile');botSay(t('custPin'));return true}
  /* report a payment — "I paid 500 via esewa" */
  if(has(txt,['paid','i pay','maile tire','तिरें','तिरे','tire','bhuktani','भुक्तानी','भुगतान','chukaya','चुकाया','report payment','report a payment','payment report','payment'])&&!has(txt,KW.list)){
    const amt=parseAmount(txt);
    startFlow('custpay',amt>0?{amount:amt}:{});return true;
  }
  if(has(txt,KW.dues)&&has(txt,KW.list)||has(txt,['मेरो उधारो','मेरा उधार','my dues','मेरी सूची'])){
    const d=M().getDB();const rows=d.credits.filter(x=>num(x.amount)>num(x.paid)).slice(0,8);
    const c=self();if(!c)return true;
    if(!rows.length){botSay(fmt(t('custClear'),{name:esc(c.name)}));return true}
    let html=t('custDuesHead');
    rows.forEach(x=>{const bal=num(x.amount)-num(x.paid);html+=`<div class="mbot-lrow"><span>${esc(x.date)}${x.items?' · '+esc(String(x.items).slice(0,26)):''}</span><b>${money(bal)}</b></div>`});
    botSay(html,{acts:act('🧾 '+(lang==='en'?'Full history':lang==='ne'?'पूरा विवरण':'पूरा विवरण'),'tab:history'),speak:t('custDuesHead')});
    return true;
  }
  if(has(txt,KW.dues)||has(txt,KW.total)){
    const c=self();if(!c)return true;
    const d=M().getDB();
    const bal=d.credits.reduce((s,x)=>s+num(x.amount)-num(x.paid),0);
    botSay(bal>0?fmt(t('custMyBal'),{name:esc(c.name),amt:money(Math.max(0,bal))}):fmt(t('custClear'),{name:esc(c.name)}),{acts:bal>0?act('📲 QR','send:'+CHIPS.cust[2].t[lang]):''});
    return true;
  }
  return false;
}
function custTab(tab){const b=document.querySelector(`.customer-tab[data-tab="${tab}"]`);if(b)b.click()}

function loginIntents(txt){
  if(has(txt,KW.loginHow)){botSay(t('loginHelp'));return true}
  if(has(txt,KW.forgot)&&has(txt,KW.pin)||has(txt,KW.forgot)){botSay(t('forgotPin'));return true}
  if(has(txt,KW.about)||has(txt,['rd mart','mart'])){botSay(t('aboutApp'));return true}
  return false;
}

function setLang(l){lang=l;localStorage.setItem(LS_LANG,l);applyLangUI();botSay(t('langSet'))}

/* ---------- send + actions ---------- */
function sendMsg(){
  const v=inEl.value.trim();
  if(!v)return;
  inEl.value='';
  addUser(v);
  showTyping();
  setTimeout(()=>{hideTyping();try{handleText(v)}catch(e){botSay(t('error')+esc(e.message||e))}},420);
}
panel.addEventListener('click',e=>{
  const b=e.target.closest('[data-mba]');
  if(!b)return;
  const a=b.dataset.mba;
  const i=a.indexOf(':');
  const k=i<0?a:a.slice(0,i),v=i<0?'':a.slice(i+1);
  try{
    if(k==='send'){inEl.value=v;sendMsg()}
    else if(k==='nav')doNav(v);
    else if(k==='cmd'&&typeof window.openCommand==='function')window.openCommand(v);
    else if(k==='st'){if(typeof window.openStatementView==='function')window.openStatementView(v);else if(typeof window.openStatement==='function')window.openStatement(v)}
    else if(k==='wa')waReminder(v);
    else if(k==='waopen'){if(typeof window.openWaReminder==='function')window.openWaReminder()}
    else if(k==='payc'){const c=M().customerById(data(),v);if(c)startFlow('payment',{customer:c.id,customerId:c.id,customerName:c.name})}
    else if(k==='bal'){const c=M().customerById(data(),v);if(c)showCustBalance(c)}
    else if(k==='pickc'&&flow){const c=M().customerById(data(),v);if(c){flow.data.customerId=c.id;flow.data.customerName=c.name;flow.data.customer=c.id;flowNext()}}
    else if(k==='cf'){if(!flow)return;if(v==='yes')flowExec();else flowCancel()}
    else if(k==='csv'&&typeof window[v]==='function')window[v]();
    else if(k==='tab')custTab(v);
    else if(k==='apr'||k==='rej'){
      const req=(data().paymentRequests||[]).find(x=>x.id===v);
      if(req)M().resolvePaymentRequest(data(),v,k==='apr')
        .then(()=>{rerender();botSay(fmt(t(k==='apr'?'reqApproved':'reqRejected'),{amt:money(req.amount),name:esc(req.customer||'Customer')}))})
        .catch(e2=>botSay(t('error')+esc(e2.message)));
    }
    else if(k==='chq'){const p=v.split('|');doMarkCheque(p[0],p[1]==='bounce'?'bounce':'clear')}
    else if(k==='prof'){const c=M().customerById(data(),v);if(c)showProfile(c)}
    else if(k==='srch'){if(typeof window.openCommand==='function')window.openCommand(v);else doNav('customers')}
    else if(k==='store'){
      M().setActiveStoreId(v);
      M().syncNow()
        .then(()=>{rerender();const st=M().getStores().find(s=>s.id===v);botSay(fmt(t('storeSet'),{name:esc(st?st.name:v)}))})
        .catch(e2=>botSay(t('syncFail')+esc(e2.message)));
    }
  }catch(err){botSay(t('error')+esc(err.message||err))}
});
$m('mbotSend').addEventListener('click',sendMsg);
inEl.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();sendMsg()}});
micBtn.addEventListener('click',startListen);
voiceBtn.addEventListener('click',()=>{voiceOn=!voiceOn;localStorage.setItem(LS_VOICE,voiceOn?'on':'off');applyLangUI();if(!voiceOn&&'speechSynthesis' in window)speechSynthesis.cancel();botSay(t(voiceOn?'voiceOnMsg':'voiceOffMsg'),{speak:voiceOn?t('voiceOnMsg'):null})});
langSel.addEventListener('change',()=>setLang(langSel.value));
$m('mbotClose').addEventListener('click',()=>panel.classList.remove('open'));
fab.addEventListener('click',()=>{
  const open=panel.classList.toggle('open');
  bubble.classList.remove('on');
  if(open){
    if(!greeted){greeted=true;setTimeout(()=>botSay(t('greet'),{speak:t('greetBack')}),300)}
    setTimeout(()=>inEl.focus(),350);
    clearInterval(bubbleTimer);bubbleTimer=null;
  }
});

/* ---------- idle bubble ---------- */
const BUBBLES=[L('Namaste! 🙏 Need help?','नमस्ते! 🙏 केही सहयोग चाहियो?','नमस्ते! 🙏 कुछ मदद चाहिए?'),L("I'm Saathi 🤖 — ask me anything!",'म साथी 🤖 — जे पनि सोध्नुस्!','मैं साथी 🤖 — कुछ भी पूछिए!')];
let bi=0;
function popBubble(){
  if(panel.classList.contains('open'))return;
  bubble.textContent=BUBBLES[bi%BUBBLES.length][lang];bi++;
  bubble.classList.add('on');
  setTimeout(()=>bubble.classList.remove('on'),4500);
}
setTimeout(popBubble,3500);
bubbleTimer=setInterval(popBubble,60000);
applyLangUI();

/* public api */
window.SaathiBot={open:()=>{if(!panel.classList.contains('open'))fab.click()},ask:m=>{inEl.value=m;sendMsg()},say:m=>botSay(m)};
})();
