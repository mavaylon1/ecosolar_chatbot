import ChatWidget from '../../../components/ChatWidget/ChatWidget.jsx'

// This is the actual embeddable page — a client's site loads this in an
// iframe (per the deployment plan: <iframe src=".../embed/ecosolarusa">).
// `clientId` isn't used yet (there's only ever one client's config right
// now), but the route is already parameterized so adding a second client
// later is a data change, not a routing change. See src/app/README.md.
export default function EmbedPage() {
  return <ChatWidget />
}
