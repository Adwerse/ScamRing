export function RingPreview() {
  return <figure className="ring-preview" aria-labelledby="ring-preview-caption">
    <div className="section-heading"><span className="eyebrow">How a connection is found</span><span className="chip">Illustration</span></div>
    <ol className="preview-trail">
      <li className="preview-listing"><span className="preview-symbol" aria-hidden="true">01</span><div><strong>A new listing</strong><span>A room that looks promising</span></div></li>
      <li className="preview-identifier"><span className="preview-symbol" aria-hidden="true">@</span><div><strong>A shared payment handle</strong><span>The same detail appears elsewhere</span></div></li>
      <li className="preview-confirmed"><span className="preview-symbol" aria-hidden="true">!</span><div><strong>A confirmed scam report</strong><span>A connection worth investigating</span></div></li>
    </ol>
    <figcaption id="ring-preview-caption">One familiar detail can reveal a bigger trail. Your actual evidence appears after you check a listing.</figcaption>
  </figure>;
}
