---
source: https://www.bumang.xyz/ko/blog/84
postId: 84
title: 외래키(Foreign Key)와 ORM 관계 매핑
category: DB / SQL / ORM
tags: [SQL, ORM]
createdAt: 2025-12-26
note: 톤앤매너 레퍼런스용. 평어체(-다), 문장 위주 서술, 실무 회고.
---

# 외래키(Foreign Key)와 ORM 관계 매핑
데이터베이스를 다루다 보면 가장 먼저 마주치는 개념 중 하나가 외래키다. 

TypeORM 같은 ORM을 쓰다 보면 `@OneToMany`, `@ManyToOne`, `@ManyToMany` 같은 데코레이터를 자연스럽게 쓰게 되는데, 이게 실제 DB 레벨에서 어떻게 동작하는지 헷갈릴 때가 많다. 이 글에서는 외래키의 본질부터 ORM이 이를 어떻게 추상화하는지까지 정리해본다.

## 외래키란
외래키(Foreign Key, FK)는 다른 테이블의 PK(Primary Key)를 참조하는 컬럼이다. 두 가지 역할을 한다.

- **관계 표현**: 테이블 간 연결(1:N, N:M)을 만든다.
- **참조 무결성 보장**: 존재하지 않는 값이 들어가는 것을 막는다.

예를 들어 `Post` 테이블의 `userId` 컬럼이 `User` 테이블의 `id`를 참조하는 FK라면, 존재하지 않는 user로 post를 만들려 할 때 DB가 에러를 던진다.

## 외래키는 어느 쪽에 있는가
핵심은 이거다. **외래키는 항상 "자식(N쪽)" 테이블에 위치한다.** 부모(1쪽) 테이블에는 FK가 없다.

```typescript
User          Post
----          ----
id (PK)  ←──  userId (FK)
name          title
              content
```

한 user가 여러 post를 가지는 1:N 관계에서, FK는 "많은 쪽"인 Post 테이블에만 존재한다. User는 자신의 PK만 가지고 있을 뿐, Post에 대한 정보를 직접 들고 있지 않다.

## ORM에서의 표현
TypeORM에서 위 관계를 표현하면 다음과 같다.

```ts
// Post (자식) — 실제 FK 컬럼이 생성되는 곳
@ManyToOne(() => User)
@JoinColumn({ name: 'userId' })
user: User;

// User (부모) — 가상 관계, DB 컬럼 생성 X
@OneToMany(() => Post, post => post.user)
posts: Post[];
```

여기서 중요한 사실이 있다. `@OneToMany`**는 DB 스키마에 아무 영향을 주지 않는다.** 실제 FK 컬럼은 `@ManyToOne`이 붙은 쪽에서만 만들어진다.
그렇다면 `@OneToMany`는 왜 쓸까? **양방향 탐색의 편의성** 때문이다.

## "양방향 탐색"의 실체
```ts
const user = await userRepo.findOne({
  where: { id: 1 },
  relations: ['posts'],
});
user.posts; // Post[]
```

이 코드는 마치 User가 Post들을 직접 들고 있는 것처럼 보인다. 하지만 내부적으로는 다음 쿼리가 실행된다.

```sql
SELECT * FROM user WHERE id = 1;
SELECT * FROM post WHERE userId = 1;  -- post 테이블을 역방향 조회
```

또는 JOIN 형태로 실행되기도 한다.

```sql
SELECT * FROM user
LEFT JOIN post ON post.userId = user.id
WHERE user.id = 1;
```

핵심은 user에 fk가 없는데도 post와의 관계를 이어주기 위해서 post 테이블 조회를 한다는 것이다.

즉, DB는 여전히 **"자식 테이블의 FK를 조건으로 거꾸로 찾는"** 단방향 구조로 동작한다. ORM이 이 과정을 감싸서 마치 양방향 관계인 것처럼 보여줄 뿐이다.

`@OneToMany`를 굳이 선언하지 않아도 단방향(자식 → 부모) 조회는 정상 동작한다. 양방향이 필요할 때만 선언하면 된다.

## M:N 관계의 구조
M:N 관계는 1:N과 본질적으로 다르다. 양쪽 테이블 모두 FK를 가지지 않는다. 대신 **두 FK를 모두 가진 "중간 테이블(Join Table)"이 별도로 존재한다.**

```typescript
Post              PostTag (조인 테이블)        Tag
----              -------                      ----
id (PK)    ←──    postId (FK)
                  tagId  (FK)    ──→          id (PK)
title             (PK: postId + tagId)        name
```

- `Post`, `Tag`: FK 없음. 서로의 존재를 직접 알지 못함.
- `PostTag`: 두 FK를 보유. 일반적으로 두 FK를 합쳐서 복합 PK로 사용.

TypeORM에서는 `@ManyToMany`와 `@JoinTable()`로 표현한다.

```ts
// Post
@ManyToMany(() => Tag)
@JoinTable() // 조인 테이블은 한쪽에만 선언
tags: Tag[];

// Tag (양방향이 필요한 경우만)
@ManyToMany(() => Post, post => post.tags)
posts: Post[];
```

`@JoinTable()`이 붙은 쪽이 조인 테이블의 소유자가 된다. TypeORM이 자동으로 `post_tags_tag` 같은 이름의 중간 테이블을 만들어준다.

주로 M:N이라해도 비즈니스 로직 상 '어느 쪽이 주인인가', '어느 쪽에서 관계를 수정하는가', '어느 쪽이 의존적인가' 등을 고려해서 더 적절한 테이블 쪽에 붙이게 된다.

 `@ManyToMany`로 연결한 두 테이블이 있으면 `@JoinTable()`은 무조건 써줘야 한다.

## 중간 테이블에 추가 정보가 필요할 때

조인 테이블에 단순히 두 FK만 두는 게 아니라, `addedAt`, `order` 같은 추가 컬럼이 필요할 때가 있다. 이때는 M:N을 그대로 쓸 수 없다. 대신 **M:N 관계를 두 개의 1:N으로 풀어서** 중간 테이블 자체를 하나의 엔티티로 승격시킨다.

```ts
@Entity()
class PostTag {
  @ManyToOne(() => Post) post: Post;
  @ManyToOne(() => Tag) tag: Tag;
  @CreateDateColumn() addedAt: Date;
}
```

이렇게 하면 중간 테이블에 자유롭게 컬럼을 추가할 수 있고, 관계 자체에 대한 메타데이터를 관리할 수 있다.

![](https://bumang-blog-s3-storage.s3.ap-northeast-2.amazonaws.com/prod/thumbnails/1779776339715_chatgpt-image-2026-5-26--03_18_23.png)

## 정리
- 외래키는 **자식(N쪽) 테이블**에만 존재한다. 부모에는 없다.
- ORM의 `@OneToMany`는 DB 스키마와 무관한 **편의 기능**이다. 실제 FK는 `@ManyToOne` 쪽에서 만들어진다.
- "양방향 탐색"은 DX 차원의 추상화일 뿐, DB는 항상 자식 테이블의 FK를 역방향으로 조회한다.
- M:N 관계는 양 테이블이 아닌 **별도의 중간 테이블**이 두 FK를 들고 있다.
- 중간 테이블에 추가 컬럼이 필요하면 M:N을 두 개의 1:N으로 분해한다.

ORM이 보여주는 객체 그래프와 실제 DB 스키마 사이의 간극을 이해하면, 관계 설계와 쿼리 최적화 모두에서 더 좋은 선택을 할 수 있다.
