// Mesure d'audience Google Analytics, chargée seulement si le visiteur l'accepte dans le bandeau cookies.
// Tant que ID_GA est vide, rien ne s'affiche et aucun cookie n'est déposé.
// « Refuser » est aussi visible qu'« Accepter » (règles de la CNIL) ; le choix est gardé 6 mois
// et le lien « Gérer les cookies » du pied de page permet d'en changer.
(function(){
 var ID_GA=''; // identifiant de la propriété Google Analytics 4, par exemple 'G-ABC123XYZ'
 var CLE='evolia-cookies',DUREE=182*24*3600*1000;
 if(!ID_GA)return;

 function lire(){try{var c=JSON.parse(localStorage.getItem(CLE));if(c&&Date.now()-c.date<DUREE)return c.choix}catch(e){}return null}
 function ecrire(choix){try{localStorage.setItem(CLE,JSON.stringify({choix:choix,date:Date.now()}))}catch(e){}}

 function charger(){
  window['ga-disable-'+ID_GA]=false;
  if(window.gtag)return;
  window.dataLayer=window.dataLayer||[];
  window.gtag=function(){window.dataLayer.push(arguments)};
  window.gtag('js',new Date());
  window.gtag('config',ID_GA);
  var s=document.createElement('script');
  s.async=true;
  s.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(ID_GA);
  document.head.appendChild(s);
 }
 // Retrait du consentement : on coupe l'envoi et on efface les cookies _ga déjà déposés
 function retirer(){
  window['ga-disable-'+ID_GA]=true;
  document.cookie.split(';').forEach(function(c){
   var nom=c.split('=')[0].trim();
   if(!/^_ga/.test(nom))return;
   var parts=location.hostname.split('.');
   for(var i=0;i<parts.length;i++)document.cookie=nom+'=; Max-Age=0; path=/; domain=.'+parts.slice(i).join('.');
   document.cookie=nom+'=; Max-Age=0; path=/';
  });
 }

 // Textes bilingues, basculés par le bouton FR/EN comme le reste du site
 function texte(fr,en){
  var s=document.createElement('span');
  s.textContent=fr;
  s.setAttribute('data-en',en.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
  if(document.documentElement.lang==='en'){s.dataset.fr=s.innerHTML;s.innerHTML=s.dataset.en}
  return s;
 }
 var bandeau=null;
 function afficher(){
  if(!bandeau){
   bandeau=document.createElement('div');
   bandeau.className='bandeau-cookies';
   bandeau.setAttribute('role','region');
   bandeau.setAttribute('aria-label','Cookies');
   var p=document.createElement('p');
   p.appendChild(texte('Avec votre accord, nous mesurons l’audience du site avec Google Analytics (cookies conservés 13 mois au maximum). Votre choix est gardé 6 mois.',
    'With your consent, we measure the site’s audience with Google Analytics (cookies kept for 13 months at most). Your choice is kept for 6 months.'));
   var a=document.createElement('a');
   a.href='/mentions-legales#cookies';
   a.appendChild(texte('En savoir plus','Learn more'));
   p.appendChild(document.createTextNode(' '));
   p.appendChild(a);
   var choix=document.createElement('div');
   choix.className='choix';
   [['refuser','Refuser','Decline'],['accepter','Accepter','Accept']].forEach(function(b){
    var x=document.createElement('button');
    x.type='button';
    x.dataset.choix=b[0];
    x.appendChild(texte(b[1],b[2]));
    choix.appendChild(x);
   });
   choix.addEventListener('click',function(e){
    var b=e.target.closest('button');
    if(!b)return;
    ecrire(b.dataset.choix);
    bandeau.hidden=true;
    if(b.dataset.choix==='accepter')charger();else retirer();
   });
   bandeau.appendChild(p);
   bandeau.appendChild(choix);
   document.body.appendChild(bandeau);
  }
  bandeau.hidden=false;
 }

 document.querySelectorAll('.gerer-cookies').forEach(function(l){
  l.hidden=false;
  l.addEventListener('click',function(e){e.preventDefault();afficher();bandeau.querySelector('button').focus()});
 });
 var choix=lire();
 if(choix==='accepter')charger();
 else if(choix!=='refuser')afficher();
})();
