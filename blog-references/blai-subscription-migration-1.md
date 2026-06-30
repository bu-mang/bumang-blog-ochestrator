---
source: https://www.bumang.xyz/ko/blog/66
postId: 66
title: 구독 BM 전환기: 1. 달리는 자동차의 타이어 교체하기
category: Blai
tags: [K8s, AWS, Blai]
createdAt: 2026-03-30
note: 톤앤매너 레퍼런스용. 평어체(-다), 문장 위주 서술, 문제→조치→효과 흐름의 실무 회고.
---

# 구독 BM 전환기: 1. 달리는 자동차의 타이어 교체하기

## 왜 구독 전환을 시도하나?
현재 Blai 개발 시계열에서 블로그 분석 기능의 고도화는 어느 정도 일단락되었다.
키워드 분석, 경쟁 포스팅 분석, AI 원고 재작성 등 유저가 필요로 하는 핵심 기능은 갖춰진 상태이며, 유지보수성 업무가 대부분인 상황이었다.

문제는 기존 비즈니스 모델의 단점을 보완하는 부분이었다. 기존 모델은 단건 결제 유저가 30일, 60일, 90일짜리 이용권을 한 번 사면 끝이었다. 이용권이 끝나갈 때쯤 유저가 직접 재구매를 결정해야 했고, 그 사이에 이탈이 발생했다. 반복 매출도 없었고, 유저 락인 효과도 약했다.

구독 모델은 이 두 가지를 동시에 해결할 수 있었다. 빌링키를 등록하면 매월 자동으로 결제가 이뤄지니 재구매 의사결정 자체가 사라진다. 해지하지 않는 한 매출이 반복된다.

그래서 분석 기능들이 고도화된 지금 시점에 구독 전환을 진행하자는 컨센서스가 합의되었다.
이제 기존 이용권 단건 결제(이용일 충전식)을 구독 결제로 전환하면서 
어떤 부분이 달라졌는지 기술적인 부분으로 설명해보겠다.


### 단건 결제 vs 구독 결제 — 무엇이 달라지는가
기존 단건 결제의 구조는 단순했다.
유저가 결제하면 `Product`가 생성되고, `end_dttm`(만료일)이 찍힌다. 
만료일이 지나면 `available: false`로 바뀌고 끝이다. 
상태 관리할 것도 없고, 갱신 로직도 필요 없다.

```typescript
// 기존 단건 결제의 Product — 만료일만 있으면 끝이다
@Schema({ collection: 'products' })
export class Product {
  @Prop({ required: true })
  user: string;

  @Prop({ required: true })
  tier: string; // 'FREE' | 'BASIC' | 'PREMIUM'
  
  @Prop({ required: true })
  available: boolean; // 만료 시 false

  @Prop({ required: false })
  end_dttm: Date; // 이용권 만료일
}
```

구독으로 전환하면서 필요해진 것들이 한꺼번에 쏟아졌다.

**빌링키 관리:** 
유저의 카드 정보를 PG사에 등록하고, 발급받은 빌링키를 AES-256-CBC로 암호화해서 저장해야 한다. 카드 변경도 지원해야 한다.

**상태 관리 추가:**
단건 결제는 상태가 2개였다(쓰고 있거나, 만료됐거나) 
구독은 4개의 상태를 관리해야 한다.

```typescript
export enum BillingSubscriptionStatus {\
  ACTIVE = 'active', // 구독 활성
  CANCELLED = 'cancelled', // 해지 (기간 만료까지 이용 가능)
  EXPIRED = 'expired', // 기간 종료 (자연 만료)
  PAYMENT_FAILED = 'payment_failed', // 최종 결제 실패 (4회 재시도 후)
}
```

`이때, cancelled`와 `expired`의 구분이 중요하다.
유저가 해지를 누르면 바로 서비스가 끊기는 게 아니다. `current_period_end`까지는 계속 이용할 수 있고, 그 이후에야 `expired`로 넘어간다. `current_period_end가 끝나기 전에 다시 구독을 이어할수도 있게 만들었다.
`

**자동 갱신 사이클:**
`next_billing_dttm`이 오면 크론이 빌링키로 결제를 시도한다. 실패하면 `retry_count`를 올리고 재시도한다. 4번 모두 실패하면 `payment_failed`로 떨어진다.

결과적으로 `BillingSubscription` 스키마는 이렇게 생겼다.
구체적인 컬럼명은 약간 다르게 적었고 타입도 생략했다.
```typescript
@Schema({ collection: 'billing_subscriptions' })
export class BillingSubscription {
   // ========== 빌링키 & 카드 정보 ==========
  @Prop({ required: true })
  user: string;

  @Prop({ required: true, enum: PaymentProvider })
  payment_provider: string; // 'inicis' | 'toss'

  @Prop({ required: true })
  bid: string; // 빌링키 (AES-256 암호화)

  @Prop({ required: true })
  card_name: string; // '신한카드'

  @Prop({ required: true })
  card_number_masked: string; // '9410-****-****-1234'

  // ========== 구독 플랜 정보 (생략) ==========
  tier,
  plan_type,
  plan_cycle_days,
  price,

  // ========== 상태 머신 (생략) ==========
  status,

  // ========== 결제일 관리 (생략) ==========
  billing_date,
  next_billing_dttm,

  // ========== 구독 기간 (생략) ==========
  current_period_start,
  current_period_end

  // ========== 결제 재시도 (생략) ==========
  retry_count
}

```

단건 결제의 `Product`와 비교하면, 관리 포인트가 확연히 늘어났다. 
빌링키 암호화, 4단계 상태 머신, 결제일 관리, 재시도 로직 등등.


## 달리는 자동차의 타이어 교체 — 공존 전략
가장 까다로운 부분은 여기였다. 새 서비스를 처음부터 구독으로 만드는 건 쉽다. 하지만 이미 **단건 결제로 이용권을 구매한 유저들이 있는 상태에서 구독을 도입해야 했다.**

![](https://bumang-blog-s3-storage.s3.ap-northeast-2.amazonaws.com/prod/thumbnails/1775912421291_screenshot-2026-04-06-at-9.41.01-pm.png)
*기존 단건 이용권일 때 프론트의 표출 내역

![](https://bumang-blog-s3-storage.s3.ap-northeast-2.amazonaws.com/prod/thumbnails/1775912527327_screenshot-2026-04-01-at-6.08.17-pm.png)
*구독 결제로 전환 후의 UI

### 1. 레거시와 구독의 구분
두 결제 모델을 공존시키기 위해, 기존 스키마에 구독 연결 필드를 추가했다.

```typescript
// Product 스키마에 추가된 필드\
@Prop({ required: false, type: String, default: null })\
billing_subscription: string; // BillingSubscription._id (구독이면 값 존재)
```

`billing_subscription`**이 **`null`**이면 단건 결제로 생성된 레거시 이용권이고, 값이 있으면 구독으로 생성된 이용권이다.** 

이 하나의 필드로 기존 로직을 건드리지 않고 구독을 얹을 수 있었다.

결제 로그`ProductLog`에도 같은 방식을 적용했다.

```typescript
// ProductLog — 단건/구독 구분 필드들
@Prop({ required: false, enum: ['DAY', 'UPGRADE', 'BILLING'], default: null })
plan_type?: string; // 'DAY' = 단건, 'BILLING' = 구독

@Prop({ required: false, type: String, default: null })
billing_subscription?: string; // 구독이면 BillingSubscription._id

@Prop({ required: false, type: Boolean, default: false })
is_recurring_charge?: boolean; // true면 크론에 의한 자동 갱신 결제

```

`plan_type`이 `'DAY'`면 레거시 단건 결제, `'BILLING'`이면 구독 결제다. `is_recurring_charge`가 `true`면 유저가 직접 결제한 게 아니라 크론이 자동으로 갱신한 것이다. 이 구분이 있어야 매출 분석에서 신규 결제와 갱신 결제를 분리할 수 있다.

### 단건 → 구독 전환 — 잔여일 크레딧
기존 단건 유저가 구독으로 넘어올 수 있는 경로도 만들어야 했다. 핵심 원칙은 하나였다 — **유저가 손해를 보면 안 되고, 서비스도 손해를 보면 안 된다.

**단건 결제로 남은 이용일을 금액으로 환산해서 크레딧으로 처리했다. 이 크레딧이 새 구독 가격보다 적을 때만 차액을 결제하고 전환할 수 있다.

```typescript
// 업그레이드 미리보기 — 차액 계산 로직의 핵심\
const remainingDays = Math.max(
  0,
  Math.ceil(
  (periodEnd.getTime() - now.getTime()) /
  (1000 * 60 * 60 * 24),
  ),
);

// 크레딧 = (현재 구독료 / 주기 일수) × 잔여일
const credit = Math.round(
  (currentRecurringPrice / subscription.plan_cycle_days) * remainingDays,
);

// 차액 = 새 구독 가격 - 크레딧 (음수면 0, 즉 전환 불가)
const upgradeCost = Math.max(0, targetPrice - credit);
```


예를 들어보자.

> 1. Basic 월구독 5만원을 쓰고 있는 유저가 **15일** 남았다. 크레딧: `(50,000 / 30) × 15 = 25,000원

`2. Premium 월구독(10만원)으로 전환하려면: `100,000 - 25,000 = 75,000원` 차액 결제를 하면 전환 된다.

3. 그런데 만약 Basic **80일**이 남아서 크레딧이 `(50,000 / 30) × 80 = 133,333원`이라면?
  -> Premium 월구독(10만원): `100,000 - 133,333 < 0` → 전환 불가.
  -> Premium 연구독(100만원): `1,000,000 - 133,333 = 866,667원` → 전환 가능.

![](https://bumang-blog-s3-storage.s3.ap-northeast-2.amazonaws.com/prod/thumbnails/1775912388471_screenshot-2026-04-06-at-9.40.53-pm.png)

**잔여 가치가 구독가보다 높으면 전환을 막았다. **이렇게 하면 유저는 남은 기간의 가치를 그대로 인정받고, 서비스는 업그레이드에 의한 매출 증가만 허용하게 된다.

기존 단건 결제자들이 손해를 본다고 느끼지 않으면서도 구독으로 바로 전환될 수 있도록 해주기 위해
전환 이력도 `ProductLog`에 기록했다.
```typescript
// 단건→구독 전환 추적 필드
@Prop({ required: false, type: String, default: null })
conversion_from_product?: string; // 전환 전 기존 Product._id

@Prop({ required: false, type: Number, default: 0 })
conversion_credit?: number; // 잔여일 크레딧 금액
```
전환이 불가능한 유저들은 자연스럽게 기존 이용권이 만료된 후 구독으로 유도했다.


### 두 바퀴를 동시에 굴리는 비용
이 공존 구조의 대가는 복잡도였다. 유저의 현재 상태를 판단할 때마다 두 가지 경로를 타야 했다.

**1.** **이용 가능 여부**: 
구독 관련 필드가 유효한가? 아니면 단건 `Product`의 `end_dttm`이 남아있는가?

**2.** **결제 이력 조회**: 
`ProductLog`에서 `plan_type`이 `'PLAIN'`인 건과 `'BILLING'`인 건을 구분해서 보여줘야 한다.

**3.** **만료 처리**: 
단건이용권 사용 중에는, 로그인 혹은 기능 사용 전에 이용권의 `end_dttm`이 남아있는지 유효성 검사를 진행하고, 만료 시 이용권의 `available 필드를 false`로 처리한다. 
구독결제에서는 다음 갱신일의 23:59:59까지는 사용할 수 있게 이용권 만료일이 세팅된다. 다음 갱신일에는 cron job으로 총 4번 갱신 시도를 한다. 

이때 만약 다음 갱신일에 만약 유저가 구독 취소를 했던 이용권(cancelled)이라면 완전 만료(`expired)` 상태로 전환한다.
이때 만약 취소는 안 했지만 4번 모두 갱신 실패를 하면(카드정지라던가의 이유로..) 구독갱신 실패(failed) 상태로 남게 한다. 사실 expired와 별다를 바는 없는 상태긴 한데, UI 상으로 실패했다는 것을 띄워줘야하기 때문에... expired와는 다른 상태로 만들어야했다.

결제 플로우도 두 벌이다. 단건 결제도 완전히 없애진 않고 일일권만 남겨놨다. 그래서 단건 결제(일일권)은 기존 토스페이먼츠 단건 결제창 → 승인 → Product 생성의 흐름이고, 구독은 토스페이먼츠 빌링키 발급 → 첫 결제 → 크론 자동갱신의 흐름으로 진행된다.
(기존 이니시스 결제는 사용하지 않지만 주석처리만 해놨다..)

이렇듯 이 복잡도를 감수한 이유는 명확했다. 기존 유저의 이용권을 강제로 끊을 수는 없었고, "차액 결제 후 구독 전환"이라는 매끄러운 경로를 제공해야 했다. 달리는 자동차의 타이어를 교체하려면, 잠시 두 바퀴를 동시에 굴릴 수밖에 없다.

![](https://bumang-blog-s3-storage.s3.ap-northeast-2.amazonaws.com/prod/thumbnails/1775914688694_screenshot-2026-04-11-at-10.37.48-pm.png)

### 마치며...
기존 이용자의 구독 전환, 구독 이용 중 업그레이드, 구독 갱신/취소 처리, 갱신 실패 시 재시도 처리, 구독 지불수단 교체... 여기에 쿠폰 적용 방식도 한 번 바꾸는 엄청난 변경 범위의 아이템이었다. 전체 BM을 싹 갈아버리는게 얼마나 힘든건지 새삼 느꼈고, 해당 아이템을 혼자 진행해내며 얻은 경험치와 자신감은 꽤 값졌다.

사실 기획적으로도 BM을 바꾼다는건 쉬운 일이 아니었다. "깔끔하게 기존 이용자들이 이용일 만료된 다음에 구독으로 전환하게 하자", "기존 이용자들이 구독으로 스무스하게 넘어와야한다.", "남은 기간 360일 남았는데 월구독으로 전환 가능한거냐. 차액은 어떻게 하나", "지금까지의 이용일을 모두 쿠폰보상으로 보상하자", ... 등등 이해관계자들 사이에 갑론을박이 많았다. 그럼에도 끝까지 잘 리드해주신 PM님한테도 고마웠다. 

### 다음 글 예고
구독 모델을 도입하면서 새로운 문제가 등장했다. 자동 갱신 결제를 크론으로 처리하는데, EKS 환경에서 여러 Pod가 동시에 같은 크론을 실행한다. 이러다 같은 유저에게 결제가 두 번 되면? 😱.. 다음 편에서는 Pod 간 크론 동시성 문제를 어떻게 해결했는지 다룬다.
