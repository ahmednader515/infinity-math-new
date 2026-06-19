import { unstable_cache, revalidateTag } from "next/cache";
import {
  getCoursesPublished,
  getCategories,
  getReviews,
  listTeachersForHomepage,
  listActiveSubscriptionPlansPublic,
  listStoreProductsPublic,
} from "@/lib/db";

/** Seconds before public catalog data is refreshed automatically. */
export const PUBLIC_CACHE_REVALIDATE_SECONDS = 60;

export const PUBLIC_CACHE_TAGS = {
  courses: "public-courses",
  categories: "public-categories",
  reviews: "public-reviews",
  teachers: "public-teachers",
  subscriptions: "public-subscriptions",
  store: "public-store",
  homepage: "homepage-settings",
} as const;

export function revalidatePublicCache(...tags: Array<(typeof PUBLIC_CACHE_TAGS)[keyof typeof PUBLIC_CACHE_TAGS]>) {
  for (const tag of tags) {
    revalidateTag(tag, "max");
  }
}

export function revalidateAllPublicCatalog() {
  revalidatePublicCache(
    PUBLIC_CACHE_TAGS.courses,
    PUBLIC_CACHE_TAGS.categories,
    PUBLIC_CACHE_TAGS.reviews,
    PUBLIC_CACHE_TAGS.teachers,
    PUBLIC_CACHE_TAGS.subscriptions,
    PUBLIC_CACHE_TAGS.store,
    PUBLIC_CACHE_TAGS.homepage,
  );
}

export async function getCoursesPublishedCached(withCategory = true) {
  return unstable_cache(
    () => getCoursesPublished(withCategory),
    ["public-courses-published", String(withCategory)],
    { revalidate: PUBLIC_CACHE_REVALIDATE_SECONDS, tags: [PUBLIC_CACHE_TAGS.courses] },
  )();
}

export async function getCategoriesCached() {
  return unstable_cache(
    () => getCategories(),
    ["public-categories"],
    { revalidate: PUBLIC_CACHE_REVALIDATE_SECONDS, tags: [PUBLIC_CACHE_TAGS.categories] },
  )();
}

export async function getReviewsCached() {
  return unstable_cache(
    () => getReviews(),
    ["public-reviews"],
    { revalidate: PUBLIC_CACHE_REVALIDATE_SECONDS, tags: [PUBLIC_CACHE_TAGS.reviews] },
  )();
}

export async function listTeachersForHomepageCached() {
  return unstable_cache(
    () => listTeachersForHomepage(),
    ["public-teachers-homepage"],
    { revalidate: PUBLIC_CACHE_REVALIDATE_SECONDS, tags: [PUBLIC_CACHE_TAGS.teachers] },
  )();
}

export async function listActiveSubscriptionPlansPublicCached() {
  return unstable_cache(
    () => listActiveSubscriptionPlansPublic(),
    ["public-subscription-plans"],
    { revalidate: PUBLIC_CACHE_REVALIDATE_SECONDS, tags: [PUBLIC_CACHE_TAGS.subscriptions] },
  )();
}

export async function listStoreProductsPublicCached() {
  return unstable_cache(
    () => listStoreProductsPublic(),
    ["public-store-products"],
    { revalidate: PUBLIC_CACHE_REVALIDATE_SECONDS, tags: [PUBLIC_CACHE_TAGS.store] },
  )();
}
