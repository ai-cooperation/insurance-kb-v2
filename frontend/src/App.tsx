import { Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Home } from './pages/Home'
import { Cards } from './pages/Cards'
import { Wiki } from './pages/Wiki'
import { Chat } from './pages/Chat'

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/cards" element={<Cards />} />
        <Route path="/wiki" element={<Wiki />} />
        <Route path="/chat" element={<Chat />} />
      </Route>
    </Routes>
  )
}

export default App
