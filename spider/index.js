const axios = require('axios');

main();
async function main(){
    let res = await getImage(1)
}


function getImage(page){
    return new Promise(resolve=>{
        axios.get(`https://www.pexels.com/zh-tw/api/v3/search/photos?query=猫&page=${page}&per_page=24&seo_tags=true`,{
            headers:{
                'content-type':'application/json',
                cookie:'active_experiment=none; _cfuvid=qon.Fn8OBUeXp1r904M2EhlBL4zLK.Q8NU5pnPxofPM-1787017978.6943798-1.0.1.1-WI0NvJRsPTgbBXJs8G6uSLWWaqNoZihQfnzMWvHS_ao; country-code-v2=SG; cf_clearance=7_t07z1KgbmeLRjd3f0QbM.EHq1MJoVUgiVJuncMwMI-1787017981-1.2.1.1-HHe7pylXqZqXm3g_xgQcb5AFEUa6Rq0hbABTbK3h0_okLi8rkEmStC80skudXG.0xrpXoCWzHzbyfx3OxNkv8.v4OjTE_46b8SVPJZWc.QIahyqKtMySz1.Zg.BAdCMsanAWqp2wwNyZFW3am1uZPV031CgWL8Z1oRi8QS.gOjGriEjZ2Pe2bkT1xMiDwXCqZh_vz6jsyz1_X2aruQQk7d0G1BZtxgCD4zYicn1M57hK4HSVSCXo2HgZeBLpbGM9iOBQ97kz3IeT1KYkb4p1S6iwqm0n9U..BDK9X6i95jfRsGt57hYXoeGzIZM2McmEWx0bdFOWZLB6kMUi8lOjrX6hHO4ZJSgk0kgP.RK.Jbk; ab.storage.sessionId.5791d6db-4410-4ace-8814-12c903a548ba=g%3Ab0e2051f-3fe1-d370-7eb9-b97087a428dd%7Ce%3A1787019780347%7Cc%3A1787017980347%7Cl%3A1787017980347; g_state={"i_l":0,"i_ll":1787017981655,"i_b":"Sv25lb9XYj7IhhN4InSoO7A1pmZFjFTWAMhN3c2WSZQ","i_e":{"enable_itp_optimization":24},"i_et":1787017981655}; ab.storage.deviceId.5791d6db-4410-4ace-8814-12c903a548ba=g%3Aad33250f-bb28-e083-761e-3bf17d8f91e3%7Ce%3Aundefined%7Cc%3A1787017990345%7Cl%3A1787017990345; OptanonAlertBoxClosed=2026-08-18T01:53:35.664Z; OptanonConsent=isGpcEnabled=0&datestamp=Tue+Aug+18+2026+09%3A53%3A35+GMT%2B0800+(%E4%B8%AD%E5%9B%BD%E6%A0%87%E5%87%86%E6%97%B6%E9%97%B4)&version=202301.1.0&isIABGlobal=false&hosts=&landingPath=NotLandingPage&groups=C0001%3A1%2CC0002%3A1%2CC0003%3A1%2CC0004%3A1; _sp_ses.9ec1=*; __cf_bm=qB54zOaWwa498vhkja_Qf9awa1Ek8ah497g4pDK2mKQ-1787020392.5801501-1.0.1.1-CU1ff7cyxyirMkmM8SbJ91cveYBXnayDgMxQInluqq21jIBTiVuEt4vSr7zDi.r2bLm8kVuqgmyEV5Pw6bUacjxBddOmwXfbsI9gS0NncFquN1G9BGAEK.IrLuEacFE5; _dd_s=rum=0&expire=1787021660693; _sp_id.9ec1=863d91af-f900-402e-b69e-a2a4aadd48f9.1787017980.2.1787020761.1787018035.de3a3e94-e74a-4e40-b281-ac356150758a.507bbc48-5483-4696-a984-fdf71f323a94.a89291ff-a689-4cfe-b207-1a847c3d3949.1787020391200.162',
            }
        }).then(res=>{
            console.log(res.data.data);
        })
    })
}