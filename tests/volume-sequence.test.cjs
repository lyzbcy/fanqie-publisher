const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mergeVolumeRows,requireVolume,isSubmissionRejection}=require('../src/volume-sequence.cjs');
const {manageVolumeSelector,MANAGE_VOLUME_SELECTOR,captureThenCommit}=require('../src/volume-sequence.cjs');
test('screenshot failure never records a completed publication',async()=>{
  let completed=false;
  await assert.rejects(captureThenCommit(async()=>{throw Error('capture timed out')},async()=>{completed=true}));
  assert.equal(completed,false);
  const order=[];
  await captureThenCommit(async()=>order.push('screenshot'),async()=>order.push('ledger'));
  assert.deepEqual(order,['screenshot','ledger']);
});
test('volume locator does not use first unrelated dropdown and rejects ambiguity',async()=>{
  const unrelated={isVolume:false},volume={isVolume:true};
  const page={locator(selector){const candidates=selector===MANAGE_VOLUME_SELECTOR?[volume]:[unrelated,volume];return{count:async()=>candidates.length,isVisible:async()=>true,selected:candidates[0]}}};
  assert.equal((await manageVolumeSelector(page)).selected,volume);
  await assert.rejects(manageVolumeSelector({locator(){return{count:async()=>2,isVisible:async()=>true}}}));
});
test('first chapter of new volume follows last chapter of prior volume',()=>{
  const rows=mergeVolumeRows([{chapter:42,volumeName:'第一卷'}, {chapter:43,volumeName:'第二卷'}]);
  assert.deepEqual(rows.map(r=>r.chapter),[43,42]);
  requireVolume(rows[0],'第二卷');
  assert.throws(()=>requireVolume(rows[1],'第二卷'));
});
test('night audit notice is not mistaken for publication rejection',()=>{
  const notice='番茄审核工作时间是7:00-24:00，夜间发文会卡在审核中状态（无法修改和删除章节）直至次日早上7-9点';
  assert.equal(isSubmissionRejection(notice),false);
  assert.equal(isSubmissionRejection('提交字数超出每日上限'),true);
  assert.equal(isSubmissionRejection(notice+' 提交失败'),true);
});
test('duplicate chapter numbers across volumes are rejected',()=>{
  assert.throws(()=>mergeVolumeRows([{chapter:43,volumeName:'第一卷'},{chapter:43,volumeName:'第二卷'}]));
});
test('long new volume does not introduce false gap from truncated old pages',()=>{
  const newRows=Array.from({length:15},(_,i)=>({chapter:60-i,volumeName:'第二卷'}));
  const oldRows=Array.from({length:15},(_,i)=>({chapter:42-i,volumeName:'第一卷'}));
  assert.deepEqual(mergeVolumeRows([...oldRows,...newRows]).map(r=>r.chapter),Array.from({length:15},(_,i)=>60-i));
});
