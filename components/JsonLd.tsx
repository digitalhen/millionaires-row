import { jsonLdString } from '@/lib/seo';

/**
 * schema.org structured data. Rendered as a plain <script> so it lands in the
 * server-rendered HTML that crawlers read; `jsonLdString` escapes `<` so an
 * owner name out of the roll can never break out of the element.
 */
export default function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdString(data) }}
    />
  );
}
