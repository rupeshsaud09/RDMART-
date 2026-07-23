const test=require('node:test');
const assert=require('node:assert/strict');
const Notifications=require('../assets/martai-notifications.js');

function memoryStorage(){
  const values=new Map();
  return{
    getItem:key=>values.has(key)?values.get(key):null,
    setItem:(key,value)=>values.set(key,String(value))
  };
}

test('notification snapshots are logged once until their details change',()=>{
  const center=Notifications.createNotificationCenter(memoryStorage());
  const item={key:'due-cheques',title:'Cheques due today',message:'2 items',count:2,amount:5000,page:'cheques',tone:'warning'};
  let state=center.sync('store:admin',[item],'2026-07-23T05:00:00.000Z');
  assert.equal(state.entries.length,1);
  state=center.sync('store:admin',[item],'2026-07-23T05:01:00.000Z');
  assert.equal(state.entries.length,1);
  state=center.sync('store:admin',[{...item,count:3,message:'3 items'}],'2026-07-23T05:02:00.000Z');
  assert.equal(state.entries.length,2);
  assert.equal(state.entries[0].count,3);
});

test('resolved reminders can create a new history event when they return',()=>{
  const center=Notifications.createNotificationCenter(memoryStorage());
  const item={key:'overdue-credit',title:'Overdue credit',count:1};
  center.sync('scope',[item],'2026-07-23T05:00:00.000Z');
  center.sync('scope',[],'2026-07-23T06:00:00.000Z');
  const state=center.sync('scope',[item],'2026-07-24T05:00:00.000Z');
  assert.equal(state.entries.length,2);
});

test('read and clear actions are isolated by store and user scope',()=>{
  const center=Notifications.createNotificationCenter(memoryStorage());
  center.record('store-a:admin',{title:'Reminder opened',type:'reminder'},'2026-07-23T05:00:00.000Z');
  center.record('store-b:admin',{title:'Another reminder'},'2026-07-23T05:00:00.000Z');
  assert.equal(center.markAllRead('store-a:admin','2026-07-23T06:00:00.000Z'),1);
  assert.equal(center.get('store-a:admin').unread,0);
  assert.equal(center.get('store-b:admin').unread,1);
  assert.equal(center.clear('store-a:admin'),1);
  assert.equal(center.get('store-a:admin').entries.length,0);
  assert.equal(center.get('store-b:admin').entries.length,1);
});

test('opening one notification marks its matching history as read',()=>{
  const center=Notifications.createNotificationCenter(memoryStorage());
  center.record('scope',{key:'pending-tasks',title:'Pending tasks'},'2026-07-23T05:00:00.000Z');
  center.record('scope',{key:'other',title:'Other event'},'2026-07-23T05:01:00.000Z');
  assert.equal(center.markRead('scope','pending-tasks','2026-07-23T06:00:00.000Z'),1);
  const state=center.get('scope');
  assert.equal(state.unread,1);
  assert.ok(state.entries.find(entry=>entry.key==='pending-tasks').readAt);
});
