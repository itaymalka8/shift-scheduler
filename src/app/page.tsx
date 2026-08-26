import Image from "next/image"
import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function Home() {
  return (
    <div className="goalx-hero-gradient min-h-screen flex flex-col items-center justify-center px-6 text-white">
      <div className="flex flex-col items-center text-center max-w-2xl">
        <Image
          src="/logo.png"
          alt="Goalx Manager"
          width={140}
          height={140}
          className="animate-goalx-float rounded-full shadow-2xl"
          priority
        />

        <h1 className="mt-8 text-4xl md:text-6xl font-bold tracking-tight">
          Goalx Manager
        </h1>
        <p className="mt-4 text-lg md:text-xl text-white/80">
          נהלו את קבוצת הכדורגל שלכם, אמנו שחקנים, קבעו טקטיקה והתחרו נגד
          מנהלים אחרים בליגה חיה
        </p>

        <div className="mt-10 flex flex-col sm:flex-row gap-4">
          <Button asChild size="lg" className="text-base px-8">
            <Link href="/signup">הקימו קבוצה עכשיו</Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="text-base px-8 border-white/30 bg-white/5 text-white hover:bg-white/15 hover:text-white"
          >
            <Link href="/signin">כניסה למנהלים קיימים</Link>
          </Button>
        </div>
      </div>

      <div className="mt-20 grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-3xl w-full">
        <FeatureCard title="ניהול סגל" description="בנו את הקבוצה שלכם ואמנו את השחקנים" />
        <FeatureCard title="טקטיקה" description="קבעו מערך משחק ותורו לפני כל מפגש" />
        <FeatureCard title="ליגה חיה" description="התחרו נגד מנהלים אמיתיים אחרים" />
      </div>
    </div>
  )
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/5 backdrop-blur-sm p-6 text-center">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-white/70">{description}</p>
    </div>
  )
}
