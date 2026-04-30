currently, if a ticket is created in the calendar views in calendar flow, the ticket gets      
  created in the project flow in the project that is open in project flow. so even if the        
  calendar view only shows Project B, it creates the ticket in project A, which is active in     
  project flow. if Project B is the only view active in calendar flow, it should create the      
  ticket for Project B regardless of what project is open in project flow. I want to add a       
  feature: a modal to prompt the user to select which project the ticket should be created for 
  should popup before showing the ticket creation modal when clicking the calendar cell to       
  create a ticket IF there are more than 1 projects showing on the calendar; otherwise, as       
  stated before, it should create the project only for the single project showing on the
  calendar view 