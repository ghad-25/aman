/* Public-domain style, minimal QR encoder for short HTTPS URLs. Byte mode, ECC-L. */
(function(g){'use strict';
const RS={1:[[26,19]],2:[[44,34]],3:[[70,55]],4:[[100,80]],5:[[134,108]],6:[[86,68],[86,68]],7:[[98,78],[98,78]],8:[[121,97],[121,97]],9:[[146,116],[146,116]],10:[[86,68],[86,68],[87,69],[87,69]],11:[[101,81],[101,81],[101,81],[101,81]],12:[[116,92],[116,92],[117,93],[117,93]]};
const ALIGN={2:[6,18],3:[6,22],4:[6,26],5:[6,30],6:[6,34],7:[6,22,38],8:[6,24,42],9:[6,26,46],10:[6,28,50],11:[6,30,54],12:[6,32,58]};
function mul(x,y){let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11D);z^=((y>>>i)&1)*x;}return z;}
function gen(n){let d=new Array(n).fill(0);d[n-1]=1,root=1;var root;for(let i=0;i<n;i++){for(let j=0;j<n;j++){d[j]=mul(d[j],root);if(j+1<n)d[j]^=d[j+1];}root=mul(root,2);}return d;}
function rem(dat,n){const div=gen(n),r=new Array(n).fill(0);for(const b of dat){const f=b^r.shift();r.push(0);for(let i=0;i<n;i++)r[i]^=mul(div[i],f);}return r;}
function encode(text){const bytes=Array.from(new TextEncoder().encode(text));let ver=0,bs;for(let v=1;v<=12;v++){let b=RS[v],cap=b.reduce((s,x)=>s+x[1],0)*8;if(bytes.length<=(v<=9?255:65535)&&(4+(v<=9?8:16)+bytes.length*8<=cap)){ver=v;bs=b;break;}}if(!ver)throw new Error('QR URL too long');
const bits=[];function add(value,count){for(let i=count-1;i>=0;i--)bits.push((value>>>i)&1)}add(4,4);add(bytes.length,ver<=9?8:16);for(const b of bytes)add(b,8);const max=bs.reduce((s,b)=>s+b[1],0)*8;for(let i=0;i<Math.min(4,max-bits.length);i++)bits.push(0);while(bits.length%8)bits.push(0);let data=[];for(let i=0;i<bits.length;i+=8){let b=0;for(let j=0;j<8;j++)b=(b<<1)|bits[i+j];data.push(b);}for(let i=0;data.length<max/8;i++)data.push(i%2?0x11:0xEC);
let blocks=[],k=0;for(const [total,dc] of bs){let d=data.slice(k,k+dc);k+=dc;blocks.push({data:d,ecc:rem(d,total-dc)});}
let words=[];for(let i=0;i<Math.max(...blocks.map(b=>b.data.length));i++)for(const b of blocks)if(i<b.data.length)words.push(b.data[i]);for(let i=0;i<Math.max(...blocks.map(b=>b.ecc.length));i++)for(const b of blocks)if(i<b.ecc.length)words.push(b.ecc[i]);
const size=17+4*ver,m=Array.from({length:size},()=>Array(size).fill(false)),used=Array.from({length:size},()=>Array(size).fill(false));
function set(x,y,d){if(x>=0&&y>=0&&x<size&&y<size){m[y][x]=!!d;used[y][x]=true;}}
function finder(cx,cy){for(let y=-4;y<=4;y++)for(let x=-4;x<=4;x++){let r=Math.max(Math.abs(x),Math.abs(y));set(cx+x,cy+y,r!==2&&r!==4)}}
finder(3,3);finder(size-4,3);finder(3,size-4);
for(let i=8;i<size-8;i++){set(6,i,i%2===0);set(i,6,i%2===0)}
for(const y of ALIGN[ver]||[])for(const x of ALIGN[ver]||[]){if((x===6&&y===6)||(x===6&&y===size-7)||(x===size-7&&y===6))continue;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(x+dx,y+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1)}
function versionBits(){if(ver<7)return;let r=ver;for(let i=0;i<12;i++)r=(r<<1)^(((r>>>11)&1)*0x1F25);let v=(ver<<12)|r;for(let i=0;i<18;i++){let bit=(v>>>i)&1,a=size-11+i%3,b=Math.floor(i/3);set(a,b,bit);set(b,a,bit);}}
versionBits();
function fmt(mask){let dat=(1<<3)|mask,r=dat;for(let i=0;i<10;i++)r=(r<<1)^(((r>>>9)&1)*0x537);let v=((dat<<10)|r)^0x5412;const bit=i=>((v>>>i)&1);for(let i=0;i<=5;i++)set(8,i,bit(i));set(8,7,bit(6));set(8,8,bit(7));set(7,8,bit(8));for(let i=9;i<15;i++)set(14-i,8,bit(i));for(let i=0;i<8;i++)set(size-1-i,8,bit(i));for(let i=8;i<15;i++)set(8,size-15+i,bit(i));set(8,size-8,true)}
fmt(0);
const stream=[];for(const b of words)for(let i=7;i>=0;i--)stream.push((b>>>i)&1);
let index=0;for(let right=size-1;right>=1;right-=2){if(right===6)right=5;for(let vert=0;vert<size;vert++){const y=(((right+1)&2)===0)?size-1-vert:vert;for(let j=0;j<2;j++){const x=right-j;if(!used[y][x]){let b=index<stream.length?stream[index]:0;index++;m[y][x]=!!(b^(((x+y)%2===0)?1:0));}}}}
fmt(0);
return m;
}
function toCanvas(text,pixels){let m=encode(text),q=4,n=m.length+q*2,s=Math.max(pixels||240,n*3),cv=document.createElement('canvas');cv.width=s;cv.height=s;let ctx=cv.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,s,s);ctx.fillStyle='#092C2B';for(let y=0;y<m.length;y++)for(let x=0;x<m.length;x++)if(m[y][x]){let x1=Math.round((x+q)*s/n),x2=Math.round((x+q+1)*s/n),y1=Math.round((y+q)*s/n),y2=Math.round((y+q+1)*s/n);ctx.fillRect(x1,y1,x2-x1,y2-y1)}return cv;}
g.AmanQR={encode,draw:function(host,text,size){let cv=toCanvas(text,size);host.replaceChildren(cv);cv.style.width='100%';cv.style.height='auto';cv.setAttribute('aria-label','رمز QR يفتح بطاقة الطوارئ التجريبية');return cv;},dataUrl:function(text,size){return toCanvas(text,size).toDataURL('image/png')}};
})(window);
