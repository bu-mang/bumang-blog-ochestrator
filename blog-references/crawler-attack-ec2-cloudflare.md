---
source: https://www.bumang.xyz/ko/blog/61
postId: 61
title: 크롤러들의 습격으로 결국 블로그 프론트도 EC2 배포 + CloudFlare로.
category: Bumang Route53
tags: [Bumang Route53]
createdAt: 2026-01-05
note: 톤앤매너 레퍼런스용. 평어체(-다), 문장 위주 서술, 실무 회고.
---

# 크롤러들의 습격으로 결국 블로그 프론트도 EC2 배포 + CloudFlare로.

## 들어가며
개인 블로그를 운영하면서 예상치 못한 문제에 직면했다. Amazonbot의 과도한 크롤링으로 Vercel Hobby 플랜의 사용량을 초과하게 된 것이다. 무료 배포 플랫폼의 한계를 체감하며, 결국 이미 운영 중이던 EC2 인스턴스로 프론트엔드를 이전하기로 결정했다. 이 글에서는 그 과정에서 겪은 문제들과 해결 방법, 그리고 배운 점들을 공유한다.

![초과한지 한 달 지나서 사용량 초기화 됐지만.. 한 번 천장을 뚫으면 hobby 플랜은 쓸 수 없게된다.](https://bumang-blog-s3-storage.s3.ap-northeast-2.amazonaws.com/prod/thumbnails/1767708815506_image.png)

## 봇 트래픽과의 전쟁 1차전은 Vercel
처음에는 Vercel Hobby 플랜으로 Next.js 프론트엔드를 배포했다. 그런데 어느 날 갑자기 사용량 초과 알림을 받았다. 로그를 확인해보니 **Amazonbot**이 사이트를 무차별적으로 크롤링하고 있었다. 결국 사용량 한도 초과..** hobby 플랜을 쓸 수 없게 되었다.**

그리고 무료 호스팅 플랜을 찾아 Netlify로 이주했다. 
또한 Next.js Middleware에 Rate Limiting을 구현했는데 아래와 같다.
```typescript
// src/middleware.ts
export function middleware(request: NextRequest) {
  const ip = request.ip ?? 'unknown';
  const userAgent = request.headers.get('user-agent') ?? '';

  // 악성 봇 차단
  const blockedBots = ['amazonbot', 'ahrefsbot', 'semrushbot'];
  if (blockedBots.some(bot => userAgent.toLowerCase().includes(bot))) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // Rate Limiting (1분에 60회)
  const requestCount = getRequestCount(ip);
  if (requestCount > 60) {
    return new NextResponse('Too Many Requests', { status: 429 });
  }

  // ... 나머지 로직
}
```

![](https://bumang-blog-s3-storage.s3.ap-northeast-2.amazonaws.com/prod/thumbnails/1767708615260_screenshot-2026-01-06-at-10.18.54-pm.png)

## Netlify로의 이주, 그리고 두 번째 위기
Netlify로 플랫폼을 옮겼지만, 문제는 계속되었다. **2025년 1월 4일 새벽 1시부터 오전 11시까지, 1시간 평균 6,900건의 요청**을 받았다. 10시간 동안 약 69,000건의 요청이 들어온 셈이다.

그리고 월 10만건의 요청을 초과하여 Netlify도 막혔다. 크롤러 맛집으로 이 블로그가 소문났나.. 인간 접속자는 별로 없을텐데 봇들만 신나게 방문해댄다. SEO는 잘 챙기고 있단 방증이려나. 

하여튼, 또 보금자리를 옮겨야 되는 상황. Netlify 결제를 고려해볼 수도 있었지만, 이미 AWS EC2(t4g.small)를 월 $10 정도로 백엔드 서버를 운영하고 있던 상황이었다. **"어차피 결제할 거면, 이미 비용을 내고 있는 EC2를 활용하자." **싶어서 EC2로 옮기기로 했다.

## 새로운 접근: EC2 + Docker + Cloudflare

### 아키텍처 설계
백엔드는 이미 EC2에서 Docker Compose로 운영 중이었기 때문에, 프론트엔드도 같은 방식으로 통합하기로 했다.

**최종 아키텍처**:

```
사용자
  ↓
Cloudflare (DNS + CDN + DDoS 보호)
  ↓
EC2 (t4g.small, ARM64)
  ↓
Nginx (리버스 프록시, SSL 종료)
  ├─ api.bumang.xyz → Backend (NestJS, 포트 3000)
  └─ bumang.xyz, www.bumang.xyz → Frontend (Next.js, 포트 4000)
```

### **Docker Compose 구성**:
- **Nginx**: 리버스 프록시, SSL 종료 (Let's Encrypt)
- **Backend**: NestJS API 서버
- **Frontend**: Next.js 애플리케이션 (새로 추가)
- **PostgreSQL**: 데이터베이스
- **Prometheus + Grafana**: 모니터링
- **Certbot**: SSL 인증서 자동 갱신

### Cloudflare를 선택한 이유
봇 트래픽 차단을 위해 CDN을 고려했다. AWS CloudFront도 있었지만, **Cloudflare가 무료 플랜이 있다. **그걸로 고민 끝.

**Cloudflare의 장점**:
- 무료 플랜에서도 무제한 트래픽
- DDoS 보호 기본 제공
- WAF(Web Application Firewall)로 봇 차단
- 자동 SSL/TLS 관리
- 설정이 간단 (DNS만 변경)

개인 블로그에는 Cloudflare가 더 적합했다.

## 구현 과정

### 1. Frontend Dockerfile 작성
Next.js의 Standalone 모드를 활용한 Multi-stage 빌드를 구성했다. 솔직하게 말하자면 AI가 뚝딱 초안을 만들어줬다. 세부적인 부분을 물어보며 수정했다.

```markdown
# ============================================
# Stage 1: Dependencies
# ============================================
FROM node:22-alpine AS deps
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY package*.json ./
RUN npm ci --only=production && \
    npm cache clean --force

# ============================================
# Stage 2: Builder
# ============================================
FROM node:22-alpine AS builder
WORKDIR /app

# 빌드 시 필요한 환경변수를 ARG로 받음
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_S3_DOMAIN

# ARG를 ENV로 변환하여 빌드 프로세스에서 사용 가능하게 함
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_S3_DOMAIN=$NEXT_PUBLIC_S3_DOMAIN

COPY package*.json ./
RUN npm ci

COPY . .

# Next.js 빌드 (standalone 모드)
# NEXT_PUBLIC_* 환경변수가 코드에 하드코딩됨
RUN npm run build

# ============================================
# Stage 3: Runner
# ============================================
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# 보안을 위한 non-root 유저 생성
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# standalone 빌드 결과물 복사
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 4000

ENV PORT=4000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
```

**핵심 포인트**:
- **Multi-stage build**: 최종 이미지 크기 최소화
- **ARG와 ENV**: 빌드 타임 환경변수 주입
- **Standalone 모드**: Next.js 서버를 독립 실행 가능하게 빌드
- **Non-root 유저**: 보안 강화


### 2. Docker Compose 설정
기존 backend compose 파일에 frontend 서비스를 추가했다. 프론트엔드 배포 시 github action으로 도커 이미지 빌드되어 프론트엔드 앱만 rollout하게 만들었다.
```typescript
services:
  nginx:
    image: nginx:alpine
    container_name: bumang_blog_nginx
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./certbot/conf:/etc/letsencrypt
      - ./certbot/www:/var/www/certbot
    depends_on:
      - app
      - frontend
    restart: unless-stopped

  frontend:
    image: bumang/bumang-blog-frontend:latest
    container_name: bumang_blog_frontend
    platform: linux/arm64
    restart: unless-stopped
    expose:
      - '4000'
    env_file:
      - ../bumang-blog-front/.env.production
    environment:
      - NODE_ENV=production
    depends_on:
      - app
    deploy:
      resources:
        limits:
          memory: 150M
        reservations:
          memory: 75M

  app:
    image: bumang/bumang-blog-backend:latest
    container_name: bumang_blog_backend
    restart: unless-stopped
    expose:
      - '3000'
    depends_on:
      - db
    env_file:
      - .env.production
    environment:
      - NODE_ENV=production
    deploy:
      resources:
        limits:
          memory: 120M

  # ... PostgreSQL, Prometheus, Grafana 등
```

### 3. Nginx 리버스 프록시 설정
Frontend와 Backend를 각각의 도메인으로 라우팅하도록 Nginx를 설정했다. 원래 백엔드 API 서버 스펙만 있었는데 프론트엔드 도메인으로 들어오는 접속도 처리하도록 바꿨다고 보면 된다. 443번으로 들어오는 https 요청은 프론트엔드로 포트포워딩 했다.
bumang.xyz, [www.bumang.xyz](https://www.bumang.xyz) 등 2개의 도메인을 대응할 수 있도록 명시해줘야하는 것이 포인트다. (bumang.xyz만 썼다가 www.bumang.xyz는 접속이 안 되는 일을 겪음..)
```typescript
http {
    upstream backend {
        server bumang_blog_backend:3000;
    }

    upstream frontend {
        server bumang_blog_frontend:4000;
    }

    # HTTPS 서버 - 백엔드 (api.bumang.xyz)
    server {
        listen 443 ssl http2;
        server_name api.bumang.xyz;

        ssl_certificate /etc/letsencrypt/live/api.bumang.xyz/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/api.bumang.xyz/privkey.pem;

        location / {
            proxy_pass http://backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }

    # HTTPS 서버 - 프론트엔드 (bumang.xyz)
    server {
        listen 443 ssl http2;
        server_name bumang.xyz www.bumang.xyz;

        ssl_certificate /etc/letsencrypt/live/bumang.xyz/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/bumang.xyz/privkey.pem;

        # Gzip 압축
        gzip on;
        gzip_vary on;
        gzip_min_length 1024;
        gzip_types text/plain text/css text/xml text/javascript
                   application/x-javascript application/xml+rss
                   application/json application/javascript;

        # 클라이언트 최대 업로드 크기
        client_max_body_size 10M;

        location / {
            proxy_pass http://frontend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }
    }
}
```

**배포 프로세스**:
1. GitHub에 코드 push
2. Docker 이미지 빌드 (ARM64 플랫폼, 환경변수 주입)
3. Docker Hub에 푸시
4. EC2에 SSH 접속
5. 최신 이미지 pull
6. docker-compose로 컨테이너 재시작
7. 헬스체크 및 로그 확인

![](https://bumang-blog-s3-storage.s3.ap-northeast-2.amazonaws.com/prod/thumbnails/1767708939752_image.png)

### 4. Cloudflare 설정
마지막으로 Cloudflare를 통해 CDN과 봇 차단을 설정했다. Cloudflare 연동은 생각보다 단순했다. 클플 가입하면 Name Server 이름을 콘솔에서 보여준다. "너가 사용하고 있는 DNS로 가서 네임서버를 교체하라. 24시간 내에 적용된다." 라고 했는데... 진짜 그게 끝이었다.
내가 사용하고 있던 hosting.kr에 들어가서 Cloudflare의 Name Server로 교체해주니 끝났다.
[hosting.kr](http://hosting.kr)에서 네임서버를 Cloudflare로 변경하면, DNS 관리가 Cloudflare로 이관된다.

![](https://bumang-blog-s3-storage.s3.ap-northeast-2.amazonaws.com/prod/thumbnails/1767708755974_screenshot-2026-01-06-at-11.11.35-pm.png)
**네임서버 변경**:
- 기존: `ns1.hostingkr.net`, `ns2.hostingkr.net
`- 변경: Cloudflare 네임서버 (예: `ava.ns.cloudflare.com`)

```markdown
# DNS 설정:

Type  | Name        | Content         | Proxy
------|-------------|-----------------|-------
A     | @                    | <EC2 IP>            | ✅ Proxied
A     | www              | <EC2 IP>            | ✅ Proxied
A     | api                  | <EC2 IP>            | ✅ Proxied
```

그리고 Nginx에서 프론트 도메인에 대한 SSL 인증서를 발급받았다. 기존에 올려뒀던 Certbot으로 받으면 된다.

**SSL/TLS 설정**:
- 암호화 모드: **Full (strict)
**  - Cloudflare ↔ 사용자: HTTPS
  - Cloudflare ↔ EC2: HTTPS + 인증서 검증
  - EC2의 Let's Encrypt 인증서 유지 필요

## 어려웠던 점들?

### 1. Nginx에서 프론트엔드 도메인 라우팅
기존에는 백엔드만 운영했기 때문에 `api.bumang.xyz` 하나만 처리하면 됐다. 프론트엔드를 추가하면서 `bumang.xyz`와 `www.bumang.xyz`도 함께 처리해야 했다. www.를 안 붙인 도메인만 추가했다가 다시 배포했어야 했다.. 도메인이 새로 생겼으니 SSL 인증서도 각각 발급 필요했고.. 자질구레하게 할게 많았다. 실무였으면 이거 다운타임 안 길어지게 유의했었어야 할텐데 어케 처리하지? 싶었다.

### 2. CORS 헤더 중복 문제
**원인**:
- Nginx에서 CORS 헤더 추가
- NestJS 백엔드에서도 `app.enableCors()` 호출
- 두 레이어에서 모두 CORS 헤더를 추가하면서 중복 발생
- 바보같이 AI가 "잠깐! Nginx를 도입했으면 CORS 설정도 해야될거에요!"라고 한거에 속아넘어간 탓.

이미 Nest.js 백엔드 앱 안에서 CORS 처리를 하고 있는데 Nginx에서도 동적 CORS 처리를 시도했다.
```typescript
map $http_origin $cors_origin {
default "";
"<https://bumang.xyz>" $http_origin;
"<https://www.bumang.xyz>" $http_origin;
}

add_header 'Access-Control-Allow-Origin' $cors_origin always;
```

중복 CORS 처리로 에러가 나자, 어느 한 곳에서만 처리하도록 역할 분담을 했어야 했다. 그리고 나는 **애플리케이션 레벨에서 CORS를 처리하는 것이 더 적합**하다고 판단했다. Nginx는 라우터로서의 역할만 시키고 Nest App이 요청을 파싱하고, 검증하고, 응답을 컨트롤하는게 낫다고 생각을 했기 때문이다.
또한 더 명시적인 곳에서 더 익숙한 앱에서 처리하는게 낫다는 이유도 있었다.

**최종 해결**:
- Nginx의 CORS 설정 제거
- 백엔드에서만 CORS 처리
앞으로는 더 의심하고... Nginx를 잘 모른다고 AI가 말하는게 답이라고 생각하면 안 된다고 느꼈다.

## 배운 점과 교훈

### 1. 온전히 "내 서비스"라는 느낌
Vercel이나 Netlify를 사용할 때는 플랫폼의 제약 안에서 움직였다. 하지만 EC2에 직접 배포하니, 서버부터 네트워크, 보안까지 모든 것을 제어할 수 있게 되었다.

물론 관리해야 할 것도 많아졌지만, 그만큼 배우는 것도 많았다. 더 소유감을 얻으려면 온프레미스 서버도 고려해야되나?? 라즈베리파이로 서버값 0원 만들기에도 도전해봐도 좋겠다.

### 2. 회사 프로젝트와의 연결
회사에서는 Kubernetes 위에 프론트엔드 앱이 올라가 있다. 일단 회사프로젝트에선 무중단 배포를 위해 Deployment.yaml 파일에 필드 몇 개 추가해본게 배포에 관여한 유일한 부분이긴 한데... ec2 컴퓨터(노드)를 클러스터로 관리하고, pod을 띄우는게 쿠버네티스니... 약간 더 알 것 같은 기분이 든다.

###  4. 비용 최적화의 중요성
무료 플랫폼의 한계를 넘어서기 위해 이미 결제 중인 리소스를 활용하는 선택을 했다.

**비용 비교**:
- Vercel Pro: $20/월
- Netlify Pro: $19/월
- EC2 t4g.small: $10/월 (백엔드 + 프론트엔드)

같은 비용으로 더 많은 제어권을 얻었다. 물론 관리 부담은 늘었지만, 개인 프로젝트에서는 충분히 감수할 만한 트레이드 오프였다. 오히려 배울 기회가 늘은거지.
