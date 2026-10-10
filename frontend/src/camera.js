export const stopStream=stream=>stream?.getTracks().forEach(track=>track.stop());
export const preferredCamera=devices=>devices.find(d=>/C920/i.test(d.label))||devices[0];
export function cameraError(error){return ({NotAllowedError:'摄像头权限未允许。请在浏览器的网站权限中允许摄像头，再重试。',NotFoundError:'未找到摄像头，请检查 USB 连接。',NotReadableError:'摄像头无法读取，可能正被微信、会议软件或其他窗口占用。',OverconstrainedError:'所选摄像头已不可用，请刷新设备列表重新选择。',SecurityError:'当前浏览器不允许访问摄像头，请用 Edge 或 Chrome 打开本地网址。'})[error.name]||error.message||'摄像头连接失败。';}
export class CameraSession{
  constructor(media){this.media=media;this.generation=0;this.stream=null;}
  stop(){this.generation++;stopStream(this.stream);this.stream=null;}
  async open(deviceId){
    this.stop();const generation=this.generation;
    const stream=await this.media.getUserMedia({audio:false,video:{...(deviceId?{deviceId:{exact:deviceId}}:{}),width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,max:30}}});
    if(generation!==this.generation){stopStream(stream);return null;}this.stream=stream;return stream;
  }
}
export function captureFrame(video,makeCanvas=()=>document.createElement('canvas')){
  if(!video||video.readyState<2||!video.videoWidth||!video.videoHeight||!video.srcObject?.getVideoTracks().some(t=>t.readyState==='live')||video.paused)throw new Error('尚未取得可用画面，请等待摄像头连接后重试。');
  const canvas=makeCanvas(),scale=Math.min(1,1920/video.videoWidth,1080/video.videoHeight);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
  const context=canvas.getContext('2d');if(!context)throw new Error('浏览器无法生成截图。');context.drawImage(video,0,0,canvas.width,canvas.height);
  const image=canvas.toDataURL('image/jpeg',.9);if(!image.startsWith('data:image/jpeg;base64,')||image.length>5_592_430)throw new Error('截图生成失败或超过 4 MB，请调整画面后重试。');
  return {image,width:canvas.width,height:canvas.height,capturedAt:new Date().toISOString()};
}
