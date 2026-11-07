// Ported from stellar/index.html Study 003: keep the core/halo and flow together.
export const vertex = `
  precision highp float;
  attribute vec3 aFrom, aTo, aTint;
  attribute vec4 aMeta, aStyle;
  attribute float aRelic;
  attribute float aField;
  uniform float uProgress,uTime,uAspect,uDpr,uHeight,uHalo,uMotion,uReveal;
  uniform float uBrightness;
  uniform float uScale,uZoom,uTint,uBreath,uKind,uTrailWidth,uDetail,uFootprint;
  uniform float uParallax,uNearParallax,uPointerStrength,uPointerScatter;
  uniform float uGravity,uAudioRole;
  uniform vec2 uGravityPointer;
  uniform vec3 uAudio;
  uniform sampler2D uSpectrum;
  uniform float uSpectrumActive;
  uniform vec4 uPulseAges,uPulseStrengths;
  uniform float uRetreat,uCoreZoom,uCoreTravel,uCoreSelected,uCoreEnergy;
  uniform vec2 uCoreFocus;
  uniform float uFieldTime;
  uniform vec3 uRelicOrigin;
  uniform vec3 uOffset;
  uniform vec4 uBrandBox;
  uniform vec2 uPointer,uCenter,uCamera,uTrailHead,uTrailVector;
  varying vec3 vColor;
  varying float vAlpha,vStar,vHalo;
  float audioWave(float position,float age,float strength){
    float head=mix(-.12,1.16,age);
    float distance=(position-head)/.06;
    return exp(-distance*distance)*sin(age*3.14159265)*strength;
  }
  vec2 spectrumAt(float position){
    float bin=clamp(position,0.,1.)*63., index=floor(bin), f=fract(bin);
    vec2 a=texture2D(uSpectrum,vec2((index-.5)/64.,.5)).rg;
    vec2 b=texture2D(uSpectrum,vec2((index+.5)/64.,.5)).rg;
    vec2 c=texture2D(uSpectrum,vec2((index+1.5)/64.,.5)).rg;
    vec2 d=texture2D(uSpectrum,vec2((index+2.5)/64.,.5)).rg;
    return clamp(.5*((2.*b)+(-a+c)*f+(2.*a-5.*b+4.*c-d)*f*f+(-a+3.*b-3.*c+d)*f*f*f),0.,1.);
  }
  void main(){
    float seed=aMeta.y;
    float delay=seed*.28+aStyle.w*.18;
    float t=clamp((uProgress-delay)/(1.-delay),0.,1.);
    float e=t*t*t*(t*(t*6.-15.)+10.);
    float envelope=sin(t*3.14159265);
    vec3 origin=aFrom;
    float turn=(1.-e)*t*(2.8+seed*2.1);
    vec2 local=origin.xy-uCenter;
    origin.xy=mat2(cos(turn),sin(turn),-sin(turn),cos(turn))*local+uCenter;
    vec3 p=mix(origin,aTo,e);
    float fieldAlpha=1.;
    if(aField>.5){
      float energy=step(1.5,uCoreSelected)*uCoreEnergy;
      float phase=fract(uFieldTime*.20+(aField-1.)/5.);
      float scale=mix(2.25,.52,phase*phase*phase);
      fieldAlpha=sin(phase*3.14159265)*(.65+energy*.65);
      if(aField>5.5){
        // Expanding cube shells launch with the entry impulse, never circular rings.
        float entry=pow(clamp(uCoreTravel,0.,1.),1./3.);
        phase=clamp((entry-.70-(aField-6.)*.035)/.23,0.,1.);
        scale=1.+(1.-pow(1.-phase,3.))*6.2;
        fieldAlpha=sin(phase*3.14159265)*pow(1.-phase,.65)*2.2;
      }
      p=uRelicOrigin+(p-uRelicOrigin)*scale;
      fieldAlpha*=smoothstep(0.,.30,uRetreat);
    }
    float trailFade=1.;
    float spectrumAlpha=1.;
    float spectrumRim=0.;
    if(uKind>2.5&&uKind<3.5){
      float q=fract(aTo.x+uTime*.15);
      vec2 normal=normalize(vec2(-uTrailVector.y,uTrailVector.x));
      float ribbon=aTo.z*.62+sin(q*9.-uTime*.8+aTo.z*2.)*.20;
      p.xy=uTrailHead+uTrailVector*q
        +normal*(ribbon+aTo.y)*uTrailWidth*(.25+q*.75);
      p.xy+=normal*sin(q*3.14159265)*uTrailWidth*1.25;
      if(uSpectrumActive>.5){
        float level=texture2D(uSpectrum,vec2(1.-q,.5)).r;
        p.xy+=normal*level*sin(q*3.14159265)*.018;
      }
      p.z=0.;
      trailFade=pow(1.-q,.7)*smoothstep(0.,.035,q);
    }
    if(uKind>4.5&&uKind<5.5){
      // Rotate the spiral in its own inclined disk, not as a flat screen sticker.
      float tilt=.50, spin=uTime*.014*uMotion;
      vec2 disk=p.xy-uCenter;
      disk=mat2(cos(tilt),-sin(tilt),sin(tilt),cos(tilt))*disk;
      disk.y/=.46;
      disk=mat2(cos(spin),sin(spin),-sin(spin),cos(spin))*disk;
      disk.y*=.46;
      p.xy=uCenter+mat2(cos(tilt),sin(tilt),-sin(tilt),cos(tilt))*disk;
    }
    if(uKind>5.5&&uKind<6.5){
      // Traveling light along the sky filaments; the star sea itself never switches off.
      float flow=.5+.5*sin(p.x*15.-p.y*12.-uTime*.48*uMotion);
      trailFade=.66+flow*.58;
      p.xy+=vec2(.0012,-.0008)*sin(uTime*.32+p.x*9.)*uMotion;
    }
    if(uKind>7.5&&uKind<8.5){
      float q=aTo.x, spread=aTo.y, kind=aTo.z;
      vec2 energy=spectrumAt(q);
      float edge=smoothstep(0.,.035,q)*(1.-smoothstep(.94,1.,q));
      float x=mix(-uAspect*.43,uAspect*.14,q);
      float baseline=x*.24-.20+sin(x*2.8)*.045+.025;
      float height=energy.x*.32*edge;
      float peak=energy.y*.32*edge;
      float thickness=(seed-.5)*.007;
      float y=baseline+height+thickness;
      spectrumRim=1.;
      spectrumAlpha=edge*smoothstep(0.,.035,energy.x)*1.0;
      if(kind>.5&&kind<1.5){
        y=baseline+height*pow(spread,.75)+(seed-.5)*.008;
        spectrumAlpha*=.20+.75*spread*spread;
        spectrumRim=0.;
      }else if(kind>1.5&&kind<2.5){
        float gap=max(0.,peak-height);
        y=baseline+height+gap*(.35+.65*spread)+(seed-.5)*.008;
        spectrumAlpha=edge*smoothstep(.003,.025,gap)*smoothstep(0.,.06,energy.y)*.85;
        spectrumRim=.5;
      }else if(kind>2.5){
        y=baseline-height*.30*spread;
        spectrumAlpha*=.25*(1.-spread*.7);
        spectrumRim=0.;
      }
      p=vec3(x,y,.08);
    }else if(uKind>1.5&&uKind<2.5&&uSpectrumActive>.5){
      float q=(p.x+uAspect*.43)/(uAspect*.57);
      float edge=smoothstep(0.,.04,q)*(1.-smoothstep(.94,1.,q));
      p.y+=texture2D(uSpectrum,vec2(clamp(q,0.,1.),.5)).r*edge*.025;
    }
    vec2 delta=aTo.xy-aFrom.xy;
    p.xy+=vec2(-delta.y,delta.x)*envelope*envelope*(.07+.13*seed);
    float eyeGather=aStyle.w*.055*smoothstep(.55,.75,t)*(1.-e);
    float eyeTurn=seed*6.2831853+t*10.*(1.-2.*aStyle.x);
    p.xy+=vec2(cos(eyeTurn),sin(eyeTurn))*eyeGather;
    p.z+=sin(seed*31.+t*6.28318)*envelope*.22;
    p=p*uScale+uOffset;
    vec2 center=uCenter*uScale+uOffset.xy;
    float drift=uMotion*uDetail*(aMeta.w>.5?.0006:mix(.0027,.0010,aStyle.z));
    p.xy+=vec2(sin(uTime*.34+p.y*26.+p.z*9.),cos(uTime*.27+p.x*23.))*drift;
    p.xy=center+(p.xy-center)*(1.+sin(uTime*.43+uBreath)*.008*uMotion);
    p.y+=sin(uTime*.38+uBreath)*.0025*uMotion*uDetail*(1.-aMeta.w);
    vec2 diff=p.xy-uPointer;
    float dist=length(diff);
    float force=(1.-smoothstep(0.,.11,dist))*.013*uMotion*uPointerStrength*uPointerScatter;
    p.xy+=diff/max(dist,.001)*force;
    float perspective=1./(1.+p.z*.40);
    p.xy=(p.xy-uCamera)*perspective*uZoom;
    vec2 mouse=clamp(vec2(uPointer.x*2./uAspect,uPointer.y*2.),vec2(-1.),vec2(1.));
    float parallax=uParallax+max(0.,-aTo.z)*uNearParallax;
    p.xy+=mouse*parallax/uHeight*uMotion;
    // Only loose dust orbits the cursor. Formed artwork and near rocks are untouched.
    if(uPointerScatter>.5&&uGravity>.0001){
      vec2 relative=p.xy-uGravityPointer;
      float radius=clamp(150./uHeight,.10,.20);
      float distance=length(relative);
      float influence=(1.-smoothstep(radius*.18,radius,distance))*uGravity;
      float angle=influence*(.65+.18*sin(uTime*.6+seed*5.));
      vec2 orbit=mat2(cos(angle),sin(angle),-sin(angle),cos(angle))*relative;
      p.xy=uGravityPointer+mix(relative,orbit*(1.-.18*influence),influence);
    }
    float retreatAlpha=1.;
    if(aRelic<.5){
      // A staggered cubic implosion, then a radial recoil into depth.
      float q=clamp((uRetreat-seed*.12)/.88,0.,1.);
      float pull=1.-pow(1.-clamp(q/.36,0.,1.),3.);
      float release=pow(clamp((q-.22)/.78,0.,1.),3.);
      float turn=release*(.30+seed*.55);
      p.xy=mat2(cos(turn),sin(turn),-sin(turn),cos(turn))*p.xy;
      p.xy*=1.-.12*pull+release*(5.+seed*8.);
      p.xy+=vec2(sin(seed*71.),cos(seed*39.))*release*.18;
      retreatAlpha=1.-smoothstep(.20,.94,q);
    }else{
      float chosen=1.-step(.1,abs(aRelic-uCoreSelected));
      p.xy=(p.xy-uCoreFocus)*uCoreZoom+uCoreFocus*(1.-uCoreTravel);
      retreatAlpha=mix(1.-uCoreEnergy*.85,1.+uCoreEnergy*1.5,chosen);
    }
    gl_Position=vec4(p.x*2./uAspect,p.y*2.,0.,1.);
    float size=mix(aMeta.x,min(aMeta.x,1.7),aStyle.w)*clamp(uHeight/900.,.75,1.35)*uDpr;
    float haloSize=aMeta.x>8.?2.3:7.;
    gl_PointSize=max(1.,size*(uHalo>.5?haloSize:1.)*perspective*pow(uZoom,.28));
    if(aRelic>.5)gl_PointSize*=min(3.5,pow(uCoreZoom,.28));
    if(aField>5.5)gl_PointSize*=uHalo>.5?5.:24.;
    vec3 neutral=mix(vec3(.53,.73,.88),vec3(1.,.92,.77),seed);
    vec3 gold=mix(vec3(1.,.43,.09),vec3(1.,.88,.52),seed*.65+.25);
    vec3 cyan=mix(vec3(.07,.40,1.),vec3(.24,.94,1.),seed*.70+.25);
    vColor=mix(neutral,mix(gold,cyan,aStyle.x),aStyle.z);
    vColor=mix(vColor,aTint,uTint);
    vColor=mix(vColor,vec3(1.,.98,.92),smoothstep(.10,.65,aStyle.w));
    if(uKind>7.5&&uKind<8.5)vColor=mix(vColor,vec3(.87,.95,1.),spectrumRim*.08);
    float twinkle=mix(.82+.18*sin(uTime*(.40+seed*.7)+seed*170.),1.,aStyle.w);
    float ridge=.72+.28*sin(p.y*96.+p.x*37.+p.z*44.);
    vAlpha=aMeta.z*twinkle*uReveal*mix(ridge,1.,aStyle.z)*aStyle.y*trailFade;
    vAlpha*=retreatAlpha*fieldAlpha*uBrightness*spectrumAlpha;
    float audioLight=0.;
    if(uAudioRole>.5&&uAudioRole<1.5){
      float position=p.x/uAspect+.5;
      float tide=audioWave(position,uPulseAges.x,uPulseStrengths.x)
        +audioWave(position,uPulseAges.y,uPulseStrengths.y)
        +audioWave(position,uPulseAges.z,uPulseStrengths.z)
        +audioWave(position,uPulseAges.w,uPulseStrengths.w);
      audioLight=min(.55,tide*.75)+uAudio.x*.12;
    }else if(uAudioRole>1.5&&uAudioRole<2.5){
      float sweep=.5+.5*sin((p.y-uCenter.y)*10.-uTime*.6+uBreath);
      audioLight=uAudio.y*(.12+sweep*.50)*(1.-aStyle.w);
    }else if(uAudioRole>2.5){
      float selected=step(.94,seed);
      audioLight=uAudio.z*selected*(.35+.65*sin(seed*160.+uTime*1.7)*sin(seed*160.+uTime*1.7));
    }
    vAlpha*=1.+audioLight;
    if(aField>5.5)vAlpha*=uHalo>.5?.025:.009;
    if(uKind>6.5&&uKind<7.5){
      // Screen-space quiet zone: the mane may pass behind the brand without washing out its lettering.
      vec2 outside=max(max(uBrandBox.xy-p.xy,p.xy-uBrandBox.zw),vec2(0.));
      vAlpha*=mix(.07,1.,smoothstep(0.,24./uHeight,length(outside)));
    }
    if(uKind>3.5&&uKind<4.5){vAlpha*=1.-smoothstep(pow(uFootprint,1.2)-.04,pow(uFootprint,1.2)+.04,seed);}
    if(aMeta.w>.5){vColor=mix(vec3(.67,.75,.86),vColor,.25);}
    // Compensate for more stars sharing a pixel as the camera pulls back.
    if(uKind>1.5&&uKind<2.5){vAlpha*=mix(.42,.9,smoothstep(1.,4.6,uZoom));}
    if(uHalo>.5){vAlpha*=mix(.023,.003,aStyle.w)*(aField>5.5?5.:1.);}
    vStar=step(.997,seed)*(1.-aMeta.w)*(1.-aStyle.w);
    vHalo=uHalo;
  }
`;

export const fragment = `
  precision mediump float;
  varying vec3 vColor;
  varying float vAlpha,vStar,vHalo;
  void main(){
    vec2 p=gl_PointCoord*2.-1.;
    float r=length(p);
    if(r>1.)discard;
    float core=exp(-r*r*9.);
    float glow=exp(-r*r*4.)*.22;
    float star=(exp(-abs(p.x)*45.)+exp(-abs(p.y)*45.))*pow(1.-r,2.)*.22*vStar;
    float a=(core+glow+star)*vAlpha;
    if(vHalo>.5)a=exp(-r*r*3.)*vAlpha;
    gl_FragColor=vec4(vColor,a);
  }
`;
