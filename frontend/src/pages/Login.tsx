import Header from '../components/landing/Header'
import LoginSection from '../components/landing/LoginSection'
import Footer from '../components/landing/Footer'

export default function Login() {
  return (
    <main className="flex min-h-screen flex-col">
      <Header />
      <LoginSection />
      <Footer />
    </main>
  )
}
