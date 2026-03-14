import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { BarChart3, Settings } from "lucide-react";
import { Link, useLocation } from "wouter";

const menuItems = [
  { title: "Analysis Terminal", icon: BarChart3, url: "/" },
];

const secondaryItems = [
  { title: "Settings", icon: Settings, url: "/settings" },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar className="border-r border-slate-200">
      <SidebarHeader className="h-14 border-b flex items-center px-6 bg-white shrink-0">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-600" />
          <span className="font-black text-sm tracking-tighter text-slate-900 uppercase">
            Akaldeep
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent className="bg-white">
        <SidebarGroup>
          <SidebarGroupLabel className="px-6 text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
            Analysis Terminal
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="px-3">
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    className="h-10 px-3 transition-colors hover:bg-slate-50"
                  >
                    <Link href={item.url} className="flex items-center gap-3">
                      <item.icon className={location === item.url ? "text-blue-600" : "text-slate-400"} size={18} />
                      <span className="text-xs font-semibold text-slate-700">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel className="px-6 text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
            System
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="px-3">
              {secondaryItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    className="h-10 px-3 transition-colors hover:bg-slate-50"
                  >
                    <Link href={item.url} className="flex items-center gap-3">
                      <item.icon className="text-slate-400" size={18} />
                      <span className="text-xs font-semibold text-slate-700">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
