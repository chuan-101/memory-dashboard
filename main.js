document.getElementById('fileInput').addEventListener('change',e=>{
  const file=e.target.files[0];
  if(!file)return;
  const reader=new FileReader();
  reader.onload=evt=>{
    const data=JSON.parse(evt.target.result);
    console.log('已解析条目：',data.length);
    document.getElementById('dashboard').hidden=false;
  };
  reader.readAsText(file,'utf-8');
});
