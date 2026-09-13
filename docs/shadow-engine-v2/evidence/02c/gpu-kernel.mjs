export function gpuKernel(f,plan,core){
 const gl=document.createElement('canvas').getContext('webgl2',{antialias:false}),ext=gl?.getExtension('EXT_disjoint_timer_query_webgl2');if(!gl||!ext)throw Error('Hardware WebGL2/timer unavailable');
 const debug=gl.getExtension('WEBGL_debug_renderer_info'),renderer=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);// Correctness run: identify software/hardware renderer; publish no performance claim.
 const width=128,height=Math.ceil(plan.points.length/width),count=plan.points.length;
 function texture(unit,internal,w,h,format,type,data){const t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,internal,w,h,0,format,type,data);return t;}
 texture(0,gl.R32I,f.w,f.h,gl.RED_INTEGER,gl.INT,f.B);
 const pts=new Float32Array(width*height*4);plan.points.forEach((p,i)=>pts.set([p[0]-f.x0,p[1]-f.y0,p[2],p[5]??0],i*4));texture(1,gl.RGBA32F,width,height,gl.RGBA,gl.FLOAT,pts);
 const out=texture(3,gl.RGBA32UI,width,height,gl.RGBA_INTEGER,gl.UNSIGNED_INT,null),horizon=texture(2,gl.RGBA32UI,width,height,gl.RGBA_INTEGER,gl.UNSIGNED_INT,null);
 const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
 const vertex=`#version 300 es
 void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0,1);}`;
 const fragment=`#version 300 es
 precision highp float;precision highp int;precision highp isampler2D;precision highp usampler2D;
 uniform isampler2D buildings;uniform sampler2D points;uniform usampler2D horizons;
 uniform ivec2 size;uniform int count;uniform int mode;uniform int receiverKind;uniform vec3 ray;uniform float maxH;
 layout(location=0)out uvec4 result;
 const float q=1./64.;const float inf=1.e30;
 void main(){ivec2 uv=ivec2(gl_FragCoord.xy);int id=uv.y*128+uv.x;result=uvec4(0);if(id>=count)return;
  vec4 receiver=texelFetch(points,uv,0);ivec2 origin=ivec2(floor(receiver.xy));
  if(receiverKind==0 && all(greaterThanEqual(origin,ivec2(0))) && all(lessThan(origin,size)) && texelFetch(buildings,origin,0).r>0){result.x=2u;return;}
  if(ray.z<=0. && mode!=1){result.x=1u;return;}
  float z0=receiver.w+(receiverKind==2?0.:q);
  if(mode==2){result.x=ray.z<uintBitsToFloat(texelFetch(horizons,uv,0).x)?1u:0u;return;}
  vec3 p=texelFetch(points,uv,0).xyz;float lo=0.,hi=mode==1?inf:max(0.,(maxH-z0)/(p.z*ray.z));
  for(int a=0;a<2;a++){float o=p[a],v=ray[a];if(v==0.){if(o<0.||o>=float(size[a]))return;}else{float s=-o/v,t=(float(size[a])-o)/v;lo=max(lo,min(s,t));hi=min(hi,max(s,t));}}
  if(!(hi>lo))return;vec2 entry=p.xy+ray.xy*lo;ivec2 cell=ivec2(floor(entry)),step=ivec2(sign(ray.xy));
  for(int a=0;a<2;a++)if(ray[a]<0.&&entry[a]==float(cell[a]))cell[a]--;
  cell=clamp(cell,ivec2(0),size-1);vec2 delta=vec2(inf),next=vec2(inf);
  for(int a=0;a<2;a++)if(ray[a]!=0.){delta[a]=abs(1./ray[a]);next[a]=(float(cell[a]+(step[a]>0?1:0))-p[a])/ray[a];}
  float t=lo,best=0.;uint cells=0u;
  // A straight ray crosses at most width+height+1 cells in this finite rectangle.
  for(int k=0;k<32768;k++){if(t>=hi||any(lessThan(cell,ivec2(0)))||any(greaterThanEqual(cell,size)))break;
   float end=min(hi,min(next.x,next.y));if(end>t){cells++;float h=float(texelFetch(buildings,cell,0).r)/64.;if(h>z0){if(mode==1)best=max(best,t==0.?inf:(h-z0)/(t*p.z));else if(z0+t*p.z*ray.z<h){result=uvec4(1u,cells,0u,0u);return;}}}
   if(end>=hi)break;bool ax=next.x<=next.y,ay=next.y<=next.x;if(ax){cell.x+=step.x;next.x+=delta.x;}if(ay){cell.y+=step.y;next.y+=delta.y;}t=end;
  }
  result=uvec4(mode==1?floatBitsToUint(best):0u,cells,0u,0u);
 }`;
 function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
 const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
 const u=n=>gl.getUniformLocation(program,n);gl.uniform1i(u('buildings'),0);gl.uniform1i(u('points'),1);gl.uniform1i(u('horizons'),2);gl.uniform2i(u('size'),f.w,f.h);gl.uniform1i(u('count'),count);gl.uniform1f(u('maxH'),f.maxQ/64);gl.viewport(0,0,width,height);
 const read=new Uint32Array(width*height*4),values=Array(count).fill(null);
 async function measure(mode,sun,receiverKind=0){
  gl.uniform1i(u("receiverKind"),receiverKind);
  const d=core.ray(sun);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,mode===1?horizon:out,0);
  // Avoid a sampler/attachment feedback loop even when its branch is inactive.
  gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,mode===1?out:horizon);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('incomplete FBO');
  const query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query);const start=performance.now();
  gl.uniform1i(u('mode'),mode);gl.uniform3f(u('ray'),d.dx,d.dy,d.slope);gl.drawArrays(gl.TRIANGLES,0,3);gl.endQuery(ext.TIME_ELAPSED_EXT);
  gl.readPixels(0,0,width,height,gl.RGBA_INTEGER,gl.UNSIGNED_INT,read);
  let answer=null;if(mode!==1){for(let i=0;i<count;i++)values[i]=read[i*4]===2?null:read[i*4];answer=core.aggregate(plan,values,sun.altitude<=0);}const wallMs=performance.now()-start;
  gl.flush();const waitStart=performance.now();while(!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)){if(performance.now()-waitStart>10000)throw Error('timer timeout');await new Promise(r=>setTimeout(r,1));}
  if(gl.getParameter(ext.GPU_DISJOINT_EXT))throw Error('disjoint sample');const gpuMs=gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6;gl.deleteQuery(query);
  if(gl.getError()!==gl.NO_ERROR)throw Error('GL error');return {wallMs,gpuMs,answer,values:[...values],cells:Array.from({length:count},(_,i)=>read[4*i+1])};
 }
 return {renderer,width,height,measure,dispose:()=>gl.getExtension("WEBGL_lose_context")?.loseContext()};
}
