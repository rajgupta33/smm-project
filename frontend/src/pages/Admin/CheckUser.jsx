import ResponsiveNavbar from "../../components/NavBar"
export default function CheckUser(){
return (
    <div className="min-h-screen bg-black text-white">
        <ResponsiveNavbar />
        <div className="flex flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-center">
                Implement logic check the activity of a particular user
            </h1>
        </div>
    </div>
)
}